/**
 * The file reader's own throws that are not its named refusals (an engine limit such as a world.json
 * nested past the call stack, met with an `api` block) reach the person as a sentence, never as the
 * engine's text.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@onlyworlds/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@onlyworlds/sdk')>()),
  readWorldFile: () => {
    throw new RangeError('Maximum call stack size exceeded');
  },
}));

import { NOT_OPENABLE, readWorldFileBytes } from './file-read';

describe('the file read when its reader throws', () => {
  it("says the file is not a world it can open, never the engine's text", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(readWorldFileBytes(new Uint8Array([1, 2, 3]))).rejects.toThrow(NOT_OPENABLE);
    await expect(readWorldFileBytes(new Uint8Array([1, 2, 3]))).rejects.not.toThrow(/call stack/);
    warn.mockRestore();
  });
});
