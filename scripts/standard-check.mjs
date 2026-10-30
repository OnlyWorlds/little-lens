// What a small world must be before Little Lens bundles it: every id one its addresses can open,
// every hidden id one of its elements, and a members list in the shape the message readers take.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Throws, naming the world and what is wrong, or returns quietly. */
export function checkWorld(where, w) {
  if (!w || typeof w !== 'object') throw new Error(`${where}: not a world`);
  if (typeof w.id !== 'string' || !UUID.test(w.id)) throw new Error(`${where}: a world id that is no UUID`);
  if (typeof w.name !== 'string' || !w.name.trim()) throw new Error(`${where}: no name`);
  if (!Array.isArray(w.elements)) throw new Error(`${where}: no elements`);
  const ids = new Set();
  for (const el of w.elements) {
    if (!el || typeof el.id !== 'string' || !UUID.test(el.id) || typeof el.type !== 'string' || !el.type) throw new Error(`${where}: an element without a UUID id and a type`);
    if (ids.has(el.id)) throw new Error(`${where}: element id ${el.id} seen twice`);
    ids.add(el.id);
  }
  if (w.hidden !== undefined) {
    if (!Array.isArray(w.hidden)) throw new Error(`${where}: hidden is not a list`);
    for (const id of w.hidden) if (!ids.has(id)) throw new Error(`${where}: hidden names ${id}, no element of this world`);
  }
  if (w.members !== undefined) {
    const row = (m) => m && typeof m === 'object' && (m.id === null || typeof m.id === 'string') && (m.character === null || typeof m.character === 'string');
    if (!Array.isArray(w.members) || !w.members.every(row)) throw new Error(`${where}: members is not a list of {id, character}`);
  }
}
