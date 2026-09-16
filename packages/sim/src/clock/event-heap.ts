import type { SimEvent } from './types.js';

export function compareSimEvents(a: SimEvent, b: SimEvent): number {
  if (a.timeUs < b.timeUs) return -1;
  if (a.timeUs > b.timeUs) return 1;
  if (a.priority < b.priority) return -1;
  if (a.priority > b.priority) return 1;
  const seqA = a.seq ?? 0n;
  const seqB = b.seq ?? 0n;
  if (seqA < seqB) return -1;
  if (seqA > seqB) return 1;
  return 0;
}

export class EventHeap {
  private heap: SimEvent[] = [];

  get size(): number {
    return this.heap.length;
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  peek(): SimEvent | undefined {
    return this.heap[0];
  }

  push(event: SimEvent): void {
    this.heap.push(event);
    this.siftUp(this.heap.length - 1);
  }

  pop(): SimEvent | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const bottom = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = bottom;
      this.siftDown(0);
    }
    return top;
  }

  clear(): void {
    this.heap = [];
  }

  toArray(): SimEvent[] {
    return [...this.heap];
  }

  private siftUp(index: number): void {
    let current = index;
    while (current > 0) {
      const parent = (current - 1) >> 1;
      if (compareSimEvents(this.heap[current], this.heap[parent]) < 0) {
        const temp = this.heap[current];
        this.heap[current] = this.heap[parent];
        this.heap[parent] = temp;
        current = parent;
      } else {
        break;
      }
    }
  }

  private siftDown(index: number): void {
    let current = index;
    const length = this.heap.length;
    while ((current << 1) + 1 < length) {
      const left = (current << 1) + 1;
      const right = left + 1;
      let smallest = current;

      if (compareSimEvents(this.heap[left], this.heap[smallest]) < 0) {
        smallest = left;
      }
      if (right < length && compareSimEvents(this.heap[right], this.heap[smallest]) < 0) {
        smallest = right;
      }

      if (smallest !== current) {
        const temp = this.heap[current];
        this.heap[current] = this.heap[smallest];
        this.heap[smallest] = temp;
        current = smallest;
      } else {
        break;
      }
    }
  }
}
