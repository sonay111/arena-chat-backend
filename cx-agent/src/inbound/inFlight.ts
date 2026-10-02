// Tracks Support Chat messages that are being handled right now, so the same message can never be
// answered twice when two paths (the backend's forwarder and the catch-up) meet it at the same
// moment. Once a message is handled, the saved history (its messageId) protects against repeats.
export class InFlightGuard {
  private ids = new Set<string>();

  /** True if the caller may handle this message; false if someone else already is. */
  tryAcquire(id: string): boolean {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    return true;
  }

  release(id: string): void {
    this.ids.delete(id);
  }
}

export const messageGuard = new InFlightGuard();
