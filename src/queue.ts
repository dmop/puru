/**
 * O(1) fixed-capacity circular buffer.
 * Used as the value buffer in buffered channels.
 * @internal
 */
export class RingBuffer<T> {
  private items: (T | undefined)[];
  private head = 0;
  private tail = 0;
  private size = 0;
  private cap: number;

  constructor(capacity: number) {
    this.cap = capacity;
    this.items = new Array<T | undefined>(capacity);
  }

  get length(): number {
    return this.size;
  }

  push(value: T): void {
    this.items[this.tail] = value;
    this.tail = (this.tail + 1) % this.cap;
    this.size++;
  }

  shift(): T | undefined {
    if (this.size === 0) return undefined;
    const value = this.items[this.head];
    this.items[this.head] = undefined; // release reference for GC
    this.head = (this.head + 1) % this.cap;
    this.size--;
    return value;
  }
}

interface FifoNode<T> {
  value: T;
  next: FifoNode<T> | null;
}

/**
 * O(1) singly-linked FIFO queue.
 * Used for pending sender/receiver waiters in channels.
 * @internal
 */
export class FifoQueue<T> {
  private head: FifoNode<T> | null = null;
  private tail: FifoNode<T> | null = null;
  private size = 0;

  get length(): number {
    return this.size;
  }

  push(value: T): void {
    const node: FifoNode<T> = { value, next: null };
    if (this.tail) {
      this.tail.next = node;
    } else {
      this.head = node;
    }
    this.tail = node;
    this.size++;
  }

  shift(): T | undefined {
    if (!this.head) return undefined;
    const node = this.head;
    this.head = node.next;
    if (!this.head) this.tail = null;
    this.size--;
    const value = node.value;
    // Release references for GC
    node.value = undefined!;
    node.next = null;
    return value;
  }

  clear(): void {
    this.head = null;
    this.tail = null;
    this.size = 0;
  }

  *[Symbol.iterator](): Iterator<T> {
    let current = this.head;
    while (current) {
      yield current.value;
      current = current.next;
    }
  }
}
