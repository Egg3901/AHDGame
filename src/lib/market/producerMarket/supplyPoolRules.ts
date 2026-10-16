/** Lazy pro-rata stock at one price. Direct withdrawals retain the same physical stock. */
export class ProducerSupplyPool {
  private readonly weights = new Map<string, number>();
  private weight = 0;
  private correction = 0;
  private factor = 1;
  private soldPerWeight = 0;
  private readonly marks = new Map<string, number>();
  private readonly sold = new Map<string, number>();
  activeCount = 0;
  hasPooledSales = false;

  add(id: string, units: number): void {
    if (!Number.isFinite(units) || units < 0 || this.factor !== 1 || this.weights.has(id))
      throw new Error("Invalid producer supply opening");
    this.weights.set(id, units);
    this.marks.set(id, 0);
    this.sold.set(id, 0);
    this.addWeight(units);
    if (units > 0) this.activeCount++;
  }

  get total(): number {
    return Math.max(0, this.weight + this.correction) * this.factor;
  }

  remaining(id: string): number {
    return this.weights.get(id)! * this.factor;
  }

  setRemaining(id: string, units: number): void {
    this.settleSold(id);
    const before = this.remaining(id);
    if (!Number.isFinite(units) || units < 0 || units > before)
      throw new Error("Invalid producer stock withdrawal");
    if (before > 0 && units === 0) this.activeCount--;
    const prior = this.weights.get(id)!;
    const next = this.factor > 0 ? units / this.factor : 0;
    this.weights.set(id, next);
    if (this.activeCount > 0) {
      this.addWeight(-prior);
      this.addWeight(next);
    } else {
      this.weight = 0;
      this.correction = 0;
    }
  }

  pooledSold(id: string): number {
    this.settleSold(id);
    return this.sold.get(id)!;
  }

  private settleSold(id: string): void {
    const units = this.weights.get(id)! * (this.soldPerWeight - this.marks.get(id)!);
    this.sold.set(id, this.sold.get(id)! + units);
    this.marks.set(id, this.soldPerWeight);
  }

  private addWeight(value: number): void {
    const next = this.weight + value;
    this.correction +=
      Math.abs(this.weight) >= Math.abs(value)
        ? this.weight - next + value
        : value - next + this.weight;
    this.weight = next;
    if (!Number.isFinite(this.weight) || !Number.isFinite(this.correction))
      throw new Error("Producer supply overflow");
  }

  take(units: number): void {
    const total = this.total;
    if (!(units > 0) || units > total) throw new Error("Invalid pooled producer withdrawal");
    this.hasPooledSales = true;
    const perWeight = units / Math.max(0, this.weight + this.correction);
    this.soldPerWeight += perWeight;
    this.factor = units === total ? 0 : Math.max(0, 1 - this.soldPerWeight);
    if (this.factor === 0) this.activeCount = 0;
  }
}
