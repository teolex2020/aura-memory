import { nowSecs } from "@aura/utils";
import { Context } from "effect";

export class Clock extends Context.Reference<{
  nowSeconds: () => number;
}>("aura.contract.Clock", {
  defaultValue() {
    return {
      nowSeconds: nowSecs,
    };
  },
}) {
  static nowSeconds = () => Clock.useSync((_) => _.nowSeconds());
  static fixed = (nowUnixSec: number) => ({ nowSeconds: () => nowUnixSec });
}
