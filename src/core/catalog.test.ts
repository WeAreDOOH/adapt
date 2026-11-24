import { describe, expect, it } from "vitest";
import { familyForDimensions, parseFormatCatalog, summariseCatalog } from "./catalog";

const CSV = `Media Owner,Format,Dimensions,Aspect Ratio\r
"Ocean Outdoor - (GB)","Piccadilly, curved screen","3840 x 1080","32:9"\r
"Global - (GB)","Portrait D6","1080 x 1920","9:16"\r
"Global - (GB)","Square","1080 x 1080","1:1"\r
`;

describe("OOH format catalogue", () => {
  it("parses quoted CSV fields and preserves source row provenance", () => {
    const formats = parseFormatCatalog(CSV);
    expect(formats).toHaveLength(3);
    expect(formats[0].name).toBe("Piccadilly, curved screen");
    expect(formats[0].sourceRow).toBe(2);
    expect(formats[0].family).toBe("ribbon");
  });

  it("summarises specifications, owners, dimensions and ratios", () => {
    expect(summariseCatalog(parseFormatCatalog(CSV))).toEqual({ specifications: 3, uniqueDimensions: 3, uniqueRatios: 3, mediaOwners: 2 });
  });

  it("classifies the four responsive format families", () => {
    expect(familyForDimensions(2560, 640)).toBe("ribbon");
    expect(familyForDimensions(1920, 1080)).toBe("landscape");
    expect(familyForDimensions(1080, 1080)).toBe("square");
    expect(familyForDimensions(1080, 1920)).toBe("portrait");
  });
});
