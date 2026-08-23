// Neutral reply shape returned by every command builder; index.ts converts
// it to grammY types. Keeps builders free of grammY so deno test stays pure.
export interface Reply {
  text: string
  buttons?: { text: string; data: string }[][]
}
