// DOM shell of the UI iframe. Bundled by scripts/build-plugin.mjs and inlined into dist/plugin/ui.html.
import type { MainToUi, UiToMain } from "../messages.ts";
import { createClient, type ClientView, type SocketLike } from "./client.ts";
import { randomNonce, uiHmac } from "./webcrypto.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $("status");
const messageEl = $("message");
const pairForm = $<HTMLFormElement>("pair");
const codeInput = $<HTMLInputElement>("code");
const unpairBtn = $<HTMLButtonElement>("unpair");
const pairAgainBtn = $<HTMLButtonElement>("pair-again");
const confirmBox = $("confirm");
const confirmText = $("confirm-text");
const logEl = $("log");

const toMain = (msg: UiToMain) => parent.postMessage({ pluginMessage: msg }, "*");

function render(v: ClientView) {
  statusEl.textContent = v.status === "needs-code" ? "Not paired" : v.status.charAt(0).toUpperCase() + v.status.slice(1);
  statusEl.dataset.status = v.status;
  messageEl.textContent = v.message;
  pairForm.hidden = !v.needsCode;
  unpairBtn.hidden = v.needsCode;
  pairAgainBtn.hidden = !v.canPairAgain;
  confirmBox.hidden = !v.confirm;
  confirmText.textContent = v.confirm ? v.confirm.summary : "";
  logEl.replaceChildren(
    ...v.log.map((e) => {
      const li = document.createElement("li");
      li.dataset.state = e.state;
      li.textContent = `${e.name} - ${e.state}${e.detail ? ` (${e.detail})` : ""}`;
      return li;
    }),
  );
}

const client = createClient({
  hmac: uiHmac,
  nonce: randomNonce,
  openSocket: (url) => new WebSocket(url) as unknown as SocketLike,
  toMain,
  onChange: render,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (t) => clearTimeout(t as number),
});

$("approve").addEventListener("click", () => client.answerConfirm(true));
$("decline").addEventListener("click", () => client.answerConfirm(false));

pairForm.addEventListener("submit", (e) => {
  e.preventDefault();
  client.pair(codeInput.value);
  codeInput.value = "";
});
unpairBtn.addEventListener("click", () => client.unpair());
pairAgainBtn.addEventListener("click", () => client.pairAgain());

onmessage = (e: MessageEvent) => {
  // Figma desktop delivers main-thread messages from a frame other than `parent` (checked in real
  // Figma, 2026-11-11), so the sender is not checked here. Hub commands are verified by signature.
  const msg = e.data?.pluginMessage as MainToUi | undefined;
  if (!msg) return;
  if (msg.type === "init") {
    $("file").textContent = msg.fileName;
    client.init(msg.secret, msg.fileName);
  } else if (msg.type === "res") {
    client.fromMain(msg.res);
  } else if (msg.type === "confirm") {
    client.confirmRequest(msg.id, msg.summary);
  } else if (msg.type === "confirm-cancel") {
    client.confirmCancel(msg.id);
  }
};

render(client.view());
toMain({ type: "ready" });
