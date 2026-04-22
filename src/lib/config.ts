export const ALL_CATEGORIES = ["AI", "MICE", "TOURISM", "STARTUP", "POLICY", "OPERATIONS", "INDUSTRY"] as const;
export type Category = (typeof ALL_CATEGORIES)[number];

export const DEFAULT_NAV_CATEGORIES: Category[] = ["AI", "MICE", "TOURISM"];
