import { clampScalar } from "./internal";

/**
 * Immutable 3D vector (double precision). TS mirror of `Numerics.Vector3`. 3D world
 * convention is +Y up (unlike `Vector2`'s screen-space +Y down).
 */
export class Vector3 {
  constructor(
    readonly x = 0,
    readonly y = 0,
    readonly z = 0,
  ) {}

  static readonly zero = new Vector3(0, 0, 0);
  static readonly one = new Vector3(1, 1, 1);
  static readonly up = new Vector3(0, 1, 0);
  static readonly down = new Vector3(0, -1, 0);
  static readonly left = new Vector3(-1, 0, 0);
  static readonly right = new Vector3(1, 0, 0);
  static readonly forward = new Vector3(0, 0, -1);
  static readonly back = new Vector3(0, 0, 1);

  static fromArray(a: readonly number[]): Vector3 {
    return new Vector3(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0);
  }

  add(v: Vector3): Vector3 {
    return new Vector3(this.x + v.x, this.y + v.y, this.z + v.z);
  }
  sub(v: Vector3): Vector3 {
    return new Vector3(this.x - v.x, this.y - v.y, this.z - v.z);
  }
  scale(s: number): Vector3 {
    return new Vector3(this.x * s, this.y * s, this.z * s);
  }
  mul(v: Vector3): Vector3 {
    return new Vector3(this.x * v.x, this.y * v.y, this.z * v.z);
  }
  div(s: number): Vector3 {
    return new Vector3(this.x / s, this.y / s, this.z / s);
  }
  neg(): Vector3 {
    return new Vector3(-this.x, -this.y, -this.z);
  }

  length(): number {
    return Math.hypot(this.x, this.y, this.z);
  }
  lengthSquared(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }
  normalized(): Vector3 {
    const l = this.length();
    return l === 0 ? Vector3.zero : new Vector3(this.x / l, this.y / l, this.z / l);
  }
  dot(v: Vector3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
  cross(v: Vector3): Vector3 {
    return new Vector3(this.y * v.z - this.z * v.y, this.z * v.x - this.x * v.z, this.x * v.y - this.y * v.x);
  }
  distanceTo(v: Vector3): number {
    return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z);
  }
  distanceSquaredTo(v: Vector3): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }
  /** Unsigned angle to `to` in radians. */
  angleTo(to: Vector3): number {
    return Math.atan2(this.cross(to).length(), this.dot(to));
  }
  directionTo(to: Vector3): Vector3 {
    return to.sub(this).normalized();
  }
  lerp(to: Vector3, weight: number): Vector3 {
    return new Vector3(
      this.x + (to.x - this.x) * weight,
      this.y + (to.y - this.y) * weight,
      this.z + (to.z - this.z) * weight,
    );
  }

  abs(): Vector3 {
    return new Vector3(Math.abs(this.x), Math.abs(this.y), Math.abs(this.z));
  }
  floor(): Vector3 {
    return new Vector3(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
  }
  ceil(): Vector3 {
    return new Vector3(Math.ceil(this.x), Math.ceil(this.y), Math.ceil(this.z));
  }
  round(): Vector3 {
    return new Vector3(Math.round(this.x), Math.round(this.y), Math.round(this.z));
  }
  sign(): Vector3 {
    return new Vector3(Math.sign(this.x), Math.sign(this.y), Math.sign(this.z));
  }
  clamp(min: Vector3, max: Vector3): Vector3 {
    return new Vector3(clampScalar(this.x, min.x, max.x), clampScalar(this.y, min.y, max.y), clampScalar(this.z, min.z, max.z));
  }
  min(v: Vector3): Vector3 {
    return new Vector3(Math.min(this.x, v.x), Math.min(this.y, v.y), Math.min(this.z, v.z));
  }
  max(v: Vector3): Vector3 {
    return new Vector3(Math.max(this.x, v.x), Math.max(this.y, v.y), Math.max(this.z, v.z));
  }

  isFinite(): boolean {
    return Number.isFinite(this.x) && Number.isFinite(this.y) && Number.isFinite(this.z);
  }
  isNormalized(): boolean {
    return Math.abs(this.lengthSquared() - 1) < 1e-6;
  }
  equals(v: Vector3): boolean {
    return this.x === v.x && this.y === v.y && this.z === v.z;
  }
  isEqualApprox(v: Vector3, epsilon = 1e-6): boolean {
    return Math.abs(this.x - v.x) < epsilon && Math.abs(this.y - v.y) < epsilon && Math.abs(this.z - v.z) < epsilon;
  }

  withX(x: number): Vector3 {
    return new Vector3(x, this.y, this.z);
  }
  withY(y: number): Vector3 {
    return new Vector3(this.x, y, this.z);
  }
  withZ(z: number): Vector3 {
    return new Vector3(this.x, this.y, z);
  }
  /** Component by index (0=x, 1=y, 2=z) — mirrors the C# `this[int]` indexer. */
  getComponent(i: number): number {
    return i === 0 ? this.x : i === 1 ? this.y : this.z;
  }
  /** Any unit vector perpendicular to this one (mirrors `Vector3.GetAnyPerpendicular`). */
  getAnyPerpendicular(): Vector3 {
    const ax = Math.abs(this.x);
    const ay = Math.abs(this.y);
    const az = Math.abs(this.z);
    const axis = ax <= ay && ax <= az ? Vector3.right : Vector3.up;
    return this.cross(axis).normalized();
  }
  isZeroApprox(epsilon = 1e-6): boolean {
    return Math.abs(this.x) < epsilon && Math.abs(this.y) < epsilon && Math.abs(this.z) < epsilon;
  }
  toArray(): [number, number, number] {
    return [this.x, this.y, this.z];
  }
  toString(): string {
    return `(${this.x}, ${this.y}, ${this.z})`;
  }
}
