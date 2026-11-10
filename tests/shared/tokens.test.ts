import { expect, it } from "vitest";
import { nearestNames } from "../../src/shared/tokens.ts";

it("nearestNames finds the closest name", () => {
  expect(nearestNames("color/bg/defualt", ["color/bg/default", "color/bg/subtle", "space/4"])[0]).toBe("color/bg/default");
});
