// The plan-sheet palette. One consistent drawing: mylar ground, drafting ink,
// brick for commerce, streetcar green for parks and new rail, asphalt charcoal
// reserved for the problem the player is here to fix.
export const THEME = {
  mylar: "#E4E6E1",
  ink: "#22303C",
  inkFaint: "#22303C55",
  brick: "#963D2E",
  green: "#2E6B4F",
  asphalt: "#3A3D40",
  highlighter: "#D9A421",
  water: "#7FA0BC",

  parkFill: "#93B48B",
  building: {
    retail: "#963D2E",
    mixeduse: "#A34A36",
    apartment: "#B09C74",
    house: "#CDC6B8",
    office: "#7C8B99",
    civic: "#5E7284",
    garage: "#8A8F94",
    other: "#B9B5A9",
  } as Record<string, string>,
  road: {
    motorway: "#99A2AA",
    primary: "#B4BBC1",
    secondary: "#C1C7CC",
    tertiary: "#D2D5D1",
    residential: "#D8DAD5",
    service: "#DCDED9",
    path: "#A8B0A6",
  } as Record<string, string>,
  roadWidth: {
    motorway: 9,
    primary: 6.5,
    secondary: 5.5,
    tertiary: 4.5,
    residential: 3.5,
    service: 1.8,
    path: 1.1,
  } as Record<string, number>,
  zone: {
    residential: "#E0DCC6",
    commercial: "#E0C6BE",
    industrial: "#CFC9D6",
  } as Record<string, string>,
};
