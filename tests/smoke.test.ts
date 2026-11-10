import { expect, test } from "vitest";
import { PORT } from "../src/shared/protocol.ts";

test("bridge port is fixed", () => {
  expect(PORT).toBe(39917);
});
