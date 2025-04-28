import { CompatWrapper } from "@paperback/types/lib/compat/0.8";
import { Kavya } from "./Kavya/Kavya";

export const Komga = CompatWrapper(
    { registerHomeSectionsInInitialise: true },
    new Kavya(undefined),
);