// Stable GUID identities for every built-in object type. The .lmb file stores these (typeId),
// decoupling on-disk identity from the display name so a type can be renamed without a migration.
// Mint a fresh GUID for a genuinely new type; never reuse or rewrite an existing one.
export const ObjectTypeId = {
  // Primitives
  Sphere: "4c285436-8f78-4a72-ae3a-40491bcb4821",
  Torus: "49b2d64c-8c25-4065-9402-76efe2088e5c",
  Ramp: "ede61155-f076-4594-8f50-623365a8bf2e",
  Pipe: "4e9acc0a-bde7-42f0-9c3c-29ce6e430d63",
  Surface: "24db1d2f-79e0-44f8-b1e7-5bfc5f546d5e",
  Plateau: "36603b89-bd06-462e-b134-7647a4cc9d70",
  Berm: "7c6ff60f-75ad-4101-be4d-09e12c58b38a",
  // Vectors
  PipeVector: "b71f0fc5-4f20-4d6c-bf92-bd3c66cd737a",
  BermVector: "f6c8ce06-e29e-4cd3-93fb-5ff2e624913e",
  SurfaceVector: "b7072fc5-6f8c-4653-af23-970271261838",
  PlateauVector: "c0bfd408-fdea-425f-ab72-3aa2e87c275d",
  Pillow: "4357e9ee-cb50-4103-92a5-f915a075b0e7",
  // Meshes
  Mesh: "e0500e2a-31a9-4b38-a899-9b1ff31e8a75",
  // Effects
  Gradient: "c27799cc-6e25-4b3a-a071-191ca341a5ee",
} as const;

export type ObjectTypeIdValue = (typeof ObjectTypeId)[keyof typeof ObjectTypeId];

