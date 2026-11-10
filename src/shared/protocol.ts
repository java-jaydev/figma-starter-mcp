export const PORT = 39917;
export const REQUEST_TIMEOUT_MS = 30_000;
export const CONFIRM_TIMEOUT_MS = 120_000;
export const CONFIRM_DELETE_THRESHOLD = 5;
// Also confirm when the deleted nodes plus all their descendants number this many layers or more.
export const CONFIRM_DESCENDANT_THRESHOLD = 50;

export type ErrorCode =
  | "PLUGIN_NOT_CONNECTED"
  | "PAIRING_REQUIRED"
  | "AUTH_FAILED"
  | "TIMEOUT"
  | "USER_DECLINED"
  | "NODE_NOT_FOUND"
  | "VARIABLE_NOT_FOUND"
  | "STYLE_NOT_FOUND"
  | "FONT_NOT_AVAILABLE"
  | "RULE_VIOLATION"
  | "INVALID_INPUT";

export const COMMANDS = [
  "status", "read_selection", "read_nodes", "read_page", "list_variables", "list_styles", "list_components",
  "export_node", "upsert_variables", "upsert_text_styles", "bind_variable", "create_section", "create_frame",
  "create_text", "create_component", "add_component_property", "create_instance", "set_instance_properties",
  "rename", "move", "resize", "set_auto_layout", "delete_nodes", "lint", "batch",
] as const;

export type CommandName = (typeof COMMANDS)[number];

export type Command = { id: string; name: CommandName; args: unknown };

export type Result =
  | { id: string; ok: true; data: unknown }
  | { id: string; ok: false; code: ErrorCode; message: string; hint?: string };

// Handshake: hub sends `challenge`; client answers `hello-*` with its nonce and proof
// (see shared/handshake.ts); hub answers `welcome` with its own proof. Secrets never cross the wire,
// except the new plugin secret in `welcome` after a code pairing (`pair: true`, proof keyed by the code).
export type Envelope =
  | { t: "challenge"; nonce: string } // hub -> client
  | { t: "hello-plugin"; nonce: string; proof: string; pair?: boolean; fileName?: string } // plugin -> hub
  | { t: "hello-peer"; nonce: string; proof: string } // peer server -> hub
  | { t: "renew-code" } // authenticated peer -> hub: issue a fresh pairing code
  | { t: "welcome"; proof: string; secret?: string } // secret only after a code pairing
  | { t: "state"; pluginConnected: boolean; pairingCode?: string; fileName?: string } // hub -> peer
  | { t: "denied"; code: ErrorCode }
  | { t: "cmd"; sig: string; cmd: Command }
  | { t: "res"; res: Result };
