// Faithful port of skyrat-processing/internal/normalmap/quadtree.go — nearest-edge-point lookup for
// the bevel stage, including the (y, then x) tie-break. Do not "improve" it; it must match Skyrat.

export interface Point {
  x: number;
  y: number;
}

const LEAF_CAPACITY = 4;

interface QuadNode {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  points: Point[]; // populated on leaves
  children: (QuadNode | null)[]; // length 4
}

export class QuadTree {
  private root: QuadNode | null;

  constructor(points: Point[], minX: number, minY: number, maxX: number, maxY: number) {
    const sorted = points.slice().sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
    this.root = buildNode(sorted, minX, minY, maxX, maxY);
  }

  /** The closest edge point to (qx, qy); ties break to smaller y, then smaller x. */
  findNearest(qx: number, qy: number): Point {
    const best: { p: Point; dist: number } = { p: { x: 0, y: 0 }, dist: Number.MAX_VALUE };
    if (this.root) searchNode(this.root, qx, qy, best);
    return best.p;
  }
}

function buildNode(points: Point[], minX: number, minY: number, maxX: number, maxY: number): QuadNode {
  const node: QuadNode = { minX, minY, maxX, maxY, points: [], children: [null, null, null, null] };
  if (points.length <= LEAF_CAPACITY || (maxX - minX <= 1 && maxY - minY <= 1)) {
    node.points = points;
    return node;
  }
  const midX = (minX + maxX) >> 1;
  const midY = (minY + maxY) >> 1;
  const buckets: Point[][] = [[], [], [], []];
  for (const p of points) {
    let idx = 0;
    if (p.x > midX) idx |= 1;
    if (p.y > midY) idx |= 2;
    buckets[idx]!.push(p);
  }
  // degenerate split (all points in one bucket) → store as a leaf instead of recursing forever
  for (const b of buckets) {
    if (b.length === points.length) {
      node.points = points;
      return node;
    }
  }
  const bounds: [number, number, number, number][] = [
    [minX, minY, midX, midY],
    [midX, minY, maxX, midY],
    [minX, midY, midX, maxY],
    [midX, midY, maxX, maxY],
  ];
  for (let i = 0; i < 4; i++) {
    if (buckets[i]!.length > 0) {
      const b = bounds[i]!;
      node.children[i] = buildNode(buckets[i]!, b[0], b[1], b[2], b[3]);
    }
  }
  return node;
}

function isLeaf(node: QuadNode): boolean {
  return node.children.every((c) => c === null);
}

function boxMinDist(node: QuadNode, qx: number, qy: number): number {
  let dx = 0;
  if (qx < node.minX) dx = node.minX - qx;
  else if (qx > node.maxX) dx = qx - node.maxX;
  let dy = 0;
  if (qy < node.minY) dy = node.minY - qy;
  else if (qy > node.maxY) dy = qy - node.maxY;
  return Math.sqrt(dx * dx + dy * dy);
}

function tieBreak(p: Point, best: Point): boolean {
  if (p.y !== best.y) return p.y < best.y;
  return p.x < best.x;
}

function searchNode(node: QuadNode, qx: number, qy: number, best: { p: Point; dist: number }): void {
  if (boxMinDist(node, qx, qy) >= best.dist) return;
  if (isLeaf(node)) {
    for (const p of node.points) {
      const dx = p.x - qx;
      const dy = p.y - qy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < best.dist || (d === best.dist && tieBreak(p, best.p))) {
        best.dist = d;
        best.p = p;
      }
    }
    return;
  }
  const entries: { node: QuadNode; dist: number }[] = [];
  for (const ch of node.children) {
    if (ch) entries.push({ node: ch, dist: boxMinDist(ch, qx, qy) });
  }
  entries.sort((a, b) => a.dist - b.dist);
  for (const e of entries) searchNode(e.node, qx, qy, best);
}
