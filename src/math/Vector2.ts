import { clampScalar } from "./internal";

/**
 * Immutable 2D vector (double precision — TS `number` is IEEE-754 float64). A TypeScript
 * mirror of `Archwyvern.Hardcoded.Numerics.Vector2`. Operations return new instances; C#
 * operator overloads become named methods (`add`, `sub`, `scale`, ...). Screen-space
 * convention: +Y is down, so `up` is (0, -1).
 */
export class Vector2 {
  constructor(
    readonly x = 0,
    readonly y = 0,
  ) {}

  static readonly zero = new Vector2(0, 0);
  static readonly one = new Vector2(1, 1);
  static readonly up = new Vector2(0, -1);
  static readonly down = new Vector2(0, 1);
  static readonly left = new Vector2(-1, 0);
  static readonly right = new Vector2(1, 0);

  /** Unit vector at `angle` radians (CCW from +X). */
  static fromAngle(angle: number): Vector2 {
    return new Vector2(Math.cos(angle), Math.sin(angle));
  }

  /** Build from a tuple/array (the `number[]` seam used by resources + form controls). */
  static fromArray(a: readonly number[]): Vector2 {
    return new Vector2(a[0] ?? 0, a[1] ?? 0);
  }

  // -- arithmetic --
  add(v: Vector2): Vector2 {
    return new Vector2(this.x + v.x, this.y + v.y);
  }
  sub(v: Vector2): Vector2 {
    return new Vector2(this.x - v.x, this.y - v.y);
  }
  /** Multiply by a scalar. */
  scale(s: number): Vector2 {
    return new Vector2(this.x * s, this.y * s);
  }
  /** Component-wise multiply by another vector. */
  mul(v: Vector2): Vector2 {
    return new Vector2(this.x * v.x, this.y * v.y);
  }
  /** Divide by a scalar. */
  div(s: number): Vector2 {
    return new Vector2(this.x / s, this.y / s);
  }
  neg(): Vector2 {
    return new Vector2(-this.x, -this.y);
  }

  // -- geometry --
  length(): number {
    return Math.hypot(this.x, this.y);
  }
  lengthSquared(): number {
    return this.x * this.x + this.y * this.y;
  }
  normalized(): Vector2 {
    const l = this.length();
    return l === 0 ? Vector2.zero : new Vector2(this.x / l, this.y / l);
  }
  dot(v: Vector2): number {
    return this.x * v.x + this.y * v.y;
  }
  /** 2D cross product (z-component of the 3D cross) — a scalar. */
  cross(v: Vector2): number {
    return this.x * v.y - this.y * v.x;
  }
  distanceTo(v: Vector2): number {
    return Math.hypot(this.x - v.x, this.y - v.y);
  }
  distanceSquaredTo(v: Vector2): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    return dx * dx + dy * dy;
  }
  /** Angle of this vector in radians (CCW from +X). */
  angle(): number {
    return Math.atan2(this.y, this.x);
  }
  /** Signed angle to `to` in radians. */
  angleTo(to: Vector2): number {
    return Math.atan2(this.cross(to), this.dot(to));
  }
  directionTo(to: Vector2): Vector2 {
    return to.sub(this).normalized();
  }
  lerp(to: Vector2, weight: number): Vector2 {
    return new Vector2(this.x + (to.x - this.x) * weight, this.y + (to.y - this.y) * weight);
  }
  /** Rotate by `angle` radians (CCW). */
  rotated(angle: number): Vector2 {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return new Vector2(this.x * c - this.y * s, this.x * s + this.y * c);
  }

  // -- component-wise --
  abs(): Vector2 {
    return new Vector2(Math.abs(this.x), Math.abs(this.y));
  }
  floor(): Vector2 {
    return new Vector2(Math.floor(this.x), Math.floor(this.y));
  }
  ceil(): Vector2 {
    return new Vector2(Math.ceil(this.x), Math.ceil(this.y));
  }
  round(): Vector2 {
    return new Vector2(Math.round(this.x), Math.round(this.y));
  }
  sign(): Vector2 {
    return new Vector2(Math.sign(this.x), Math.sign(this.y));
  }
  clamp(min: Vector2, max: Vector2): Vector2 {
    return new Vector2(clampScalar(this.x, min.x, max.x), clampScalar(this.y, min.y, max.y));
  }
  min(v: Vector2): Vector2 {
    return new Vector2(Math.min(this.x, v.x), Math.min(this.y, v.y));
  }
  max(v: Vector2): Vector2 {
    return new Vector2(Math.max(this.x, v.x), Math.max(this.y, v.y));
  }

  // -- predicates --
  isFinite(): boolean {
    return Number.isFinite(this.x) && Number.isFinite(this.y);
  }
  isNormalized(): boolean {
    return Math.abs(this.lengthSquared() - 1) < 1e-6;
  }
  equals(v: Vector2): boolean {
    return this.x === v.x && this.y === v.y;
  }
  isEqualApprox(v: Vector2, epsilon = 1e-6): boolean {
    return Math.abs(this.x - v.x) < epsilon && Math.abs(this.y - v.y) < epsilon;
  }

  // -- builders / conversions --
  withX(x: number): Vector2 {
    return new Vector2(x, this.y);
  }
  withY(y: number): Vector2 {
    return new Vector2(this.x, y);
  }
  /** Component by index (0=x, 1=y) — mirrors the C# `this[int]` indexer. */
  getComponent(i: number): number {
    return i === 0 ? this.x : this.y;
  }
  toArray(): [number, number] {
    return [this.x, this.y];
  }
  toString(): string {
    return `(${this.x}, ${this.y})`;
  }
}
