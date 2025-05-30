import {
	PartialSourceManga,
	Request,
	RequestManager,
	SearchRequest,
	SourceStateManager
} from '@paperback/types/lib/compat/0.8';
import { CacheManager } from './CacheManager';
import {
	KavitaRequestInterceptor,
	getKavitaAPI,
	getOptions,
	getServerUnavailableMangaTiles,
	searchRequestToString
} from './Common';

const KAVITA_PERSON_ROLES: any = {
	'1': 'other',
	'2': 'artist',
	'3': 'writers', // KavitaAPI /api/series/all uses 'writers' instead of 'writer'
	'4': 'penciller',
	'5': 'inker',
	'6': 'colorist',
	'7': 'letterer',
	'8': 'coverArtist',
	'9': 'editor',
	'10': 'publisher',
	'11': 'character',
	'12': 'translators' // KavitaAPI /api/series/all uses 'translators' instead of 'translator'
}

export async function searchRequest(
	searchQuery: SearchRequest,
	metadata: any,
	requestManager: RequestManager,
	interceptor: KavitaRequestInterceptor,
	stateManager: SourceStateManager,
	cacheManager: CacheManager
) {
	// This function is also called when the user search in an other source. It should not throw if the server is unavailable.
	if (!(await interceptor.isServerAvailable())) {
		return App.createPagedResults({
			results: getServerUnavailableMangaTiles(),
		});
	}
	
	const kavitaAPI = await getKavitaAPI(stateManager);
	const { enableRecursiveSearch, excludeUnsupportedLibrary, pageSize } = await getOptions(stateManager);
	const page: number = metadata?.page ?? 0;

	const excludeLibraryIds: number[] = [];

	if (excludeUnsupportedLibrary) {
		const request = App.createRequest({
			url: `${kavitaAPI.url}/Library/libraries`,
			method: 'GET'
		});

		const response = await requestManager.schedule(request, 1);
		const result = JSON.parse(response.data ?? '[]');

		for (const library of result) {
			if (library.type === 2 || library.type === 4) {
				excludeLibraryIds.push(library.id);
			}
		}
	}

	const titleSearchIds: string[] = [];
	
	const tagSearchTiles: PartialSourceManga[] = [];
	const titleSearchTiles: PartialSourceManga[] = [];

	let result: any = cacheManager.getCachedData(searchRequestToString(searchQuery));
	if (result === undefined) {
		if (typeof searchQuery.title === 'string' && searchQuery.title !== '') {			
			const titleRequest = App.createRequest({
				url: `${kavitaAPI.url}/Search/search`,
				param: `?queryString=${encodeURIComponent(searchQuery.title)}`,
				method: 'GET'
			});
	
			// We don't want to throw if the server is unavailable
			const titleResponse = await requestManager.schedule(titleRequest, 1);
			const titleResult = JSON.parse(titleResponse.data ?? '[]');
	
			for (const manga of titleResult.series) {
				if (excludeLibraryIds.includes(manga.libraryId)) {
					continue;
				}
	
				titleSearchIds.push(manga.seriesId);
				titleSearchTiles.push(
					App.createPartialSourceManga({
						title: manga.name,
						image: `${kavitaAPI.url}/image/series-cover?seriesId=${manga.seriesId}&apiKey=${kavitaAPI.key}`,
						mangaId: `${manga.seriesId}`,
						subtitle: undefined
					})
				);
			}
	
			if (enableRecursiveSearch) {
				const tagNames: string[] = ['persons', 'genres', 'tags'];
	
				for (const tagName of tagNames) {
					for (const item of titleResult[tagName]) {
						let titleTagRequest: Request;
	
						switch (tagName) {
							case 'persons':
								titleTagRequest = App.createRequest({
									url: `${kavitaAPI.url}/Series/all`,
									data: JSON.stringify({[KAVITA_PERSON_ROLES[item.role]]: [item.id]}),
									method: 'POST'
								});
								break;
							default:
								titleTagRequest = App.createRequest({
									url: `${kavitaAPI.url}/Series/all`,
									data: JSON.stringify({[tagName]: [item.id]}),
									method: 'POST'
								});
						}
	
						const titleTagResponse = await requestManager.schedule(titleTagRequest, 1);
						const titleTagResult = JSON.parse(titleTagResponse.data ?? '[]');
	
						for (const manga of titleTagResult) {
							if (!titleSearchIds.includes(manga.id)) {
								titleSearchIds.push(manga.id);
								titleSearchTiles.push(
									App.createPartialSourceManga({
										title: manga.name,
										image: `${kavitaAPI.url}/image/series-cover?seriesId=${manga.id}&apiKey=${kavitaAPI.key}`,
										mangaId: `${manga.id}`,
										subtitle: undefined
									})
								);
							}
						}
					}
				}
			}
		}
	
		if (typeof searchQuery.includedTags !== 'undefined') {
			const body: any = {};
			const peopleTags: string[] = [];
	
			searchQuery.includedTags.forEach(async (tag) => {
				switch (tag.id.split('-')[0]) {
					case 'people':
						peopleTags.push(tag.label);
						break;
					default:
						body[tag.id.split('-')[0] ?? ''] = body[tag.id.split('-')[0] ?? ''] ?? []
						body[tag.id.split('-')[0] ?? ''].push(parseInt(tag.id.split('-')[1] ?? '0'));
				}
			});
	
			const peopleRequest = App.createRequest({
				url: `${kavitaAPI.url}/Metadata/people`,
				method: 'GET'
			});
	
			const peopleResponse = await requestManager.schedule(peopleRequest, 1);
			const peopleResult = JSON.parse(peopleResponse.data ?? '[]');
	
			for (const people of peopleResult) {
				if (peopleTags.includes(people.name)) {
					body[KAVITA_PERSON_ROLES[people.role]] = body[KAVITA_PERSON_ROLES[people.role]] ?? [];
					body[KAVITA_PERSON_ROLES[people.role]].push(people.id);
				}
			}
			
			const tagRequst = App.createRequest({
				url: `${kavitaAPI.url}/Series/all`,
				data: JSON.stringify(body),
				method: 'POST'
			});
	
			const tagResponse = await requestManager.schedule(tagRequst, 1);
			const tagResult = JSON.parse(tagResponse.data ?? '[]');
	
			for (const manga of tagResult) {
				tagSearchTiles.push(
					App.createPartialSourceManga({
						title: manga.name,
						image: `${kavitaAPI.url}/image/series-cover?seriesId=${manga.id}&apiKey=${kavitaAPI.key}`,
						mangaId: `${manga.id}`,
						subtitle: undefined
					})
				);
			}
		}
	
		result = (tagSearchTiles.length > 0 && titleSearchTiles.length > 0) ? tagSearchTiles.filter((value) => titleSearchTiles.some((target) => target.image === value.image)) : titleSearchTiles.concat(tagSearchTiles)
		cacheManager.setCachedData(searchRequestToString(searchQuery), result)
	}

	result = result.slice(page * pageSize, (page + 1) * pageSize);
	metadata = result.length === 0 ? undefined : { page: page + 1 };

	return App.createPagedResults({
		results: result,
		metadata: metadata
	});
}