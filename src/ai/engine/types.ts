// Pluggable AI engine contract.
//
// The app ships one engine — `local-rules` — which is the deterministic on-device
// NLP + orchestrator. It needs no model download and works fully offline.
//
// An *advanced* engine (a small on-device LLM) is intentionally NOT bundled: it is a
// separate, opt-in add-on. Anyone who wants it installs a companion module that owns
// the native runtime (e.g. `llama.rn`) and a model file, and registers itself through
// `registerAiEngine()`. The default build never imports that module, so it stays small
// and cannot break. See ./README.md for the install steps.

export type AiEngineId = 'local-rules' | 'on-device-llm' | (string & {});

export interface AiEngineDescriptor {
  id: AiEngineId;
  label: { bn: string; en: string };
  description: { bn: string; en: string };
  /** True when the engine ships in every build with no download or extra install. */
  builtIn: boolean;
}

export interface AiGenerateOptions {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /** The model's role for this call — sent as a system message in its own chat template. */
  system?: string;
  /** Force the reply into this JSON schema. */
  jsonSchema?: object;
}

export interface AiEngine {
  readonly descriptor: AiEngineDescriptor;
  /** Whether this engine can run right now on this device (runtime + weights present). */
  isReady(): Promise<boolean>;
  /**
   * Free-form text generation. The built-in rule engine does not do free-form output
   * and omits this; an installed on-device LLM engine implements it. Callers must
   * always have a non-LLM fallback path.
   */
  generate?(prompt: string, options?: AiGenerateOptions): Promise<string>;
}
