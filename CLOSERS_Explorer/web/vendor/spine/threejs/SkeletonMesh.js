/******************************************************************************
 * Spine Runtimes License Agreement
 * Last updated April 5, 2025. Replaces all prior versions.
 *
 * Copyright (c) 2013-2025, Esoteric Software LLC
 *
 * Integration of the Spine Runtimes into software or otherwise creating
 * derivative works of the Spine Runtimes is permitted under the terms and
 * conditions of Section 2 of the Spine Editor License Agreement:
 * http://esotericsoftware.com/spine-editor-license
 *
 * Otherwise, it is permitted to integrate the Spine Runtimes into software
 * or otherwise create derivative works of the Spine Runtimes (collectively,
 * "Products"), provided that each user of the Products must obtain their own
 * Spine Editor license and redistribution of the Products in any form must
 * include this license and copyright notice.
 *
 * THE SPINE RUNTIMES ARE PROVIDED BY ESOTERIC SOFTWARE LLC "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL ESOTERIC SOFTWARE LLC BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES,
 * BUSINESS INTERRUPTION, OR LOSS OF USE, DATA, OR PROFITS) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THE SPINE RUNTIMES, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *****************************************************************************/
import * as THREE from "../../three/three.module.min.js";
import { AnimationState, AnimationStateData, ClippingAttachment, Color, MeshAttachment, Physics, RegionAttachment, Skeleton, SkeletonClipping, Utils, Vector2, } from "../core/index.js";
import { MeshBatcher } from "./MeshBatcher.js";
export class SkeletonMesh extends THREE.Object3D {
    // public static readonly DEFAULT_MATERIAL_PARAMETERS: THREE.MaterialParameters = {
    static DEFAULT_MATERIAL_PARAMETERS = {
        side: THREE.DoubleSide,
        depthWrite: true,
        depthTest: true,
        transparent: true,
        alphaTest: 0.001,
        vertexColors: true,
        premultipliedAlpha: true,
    };
    tempPos = new Vector2();
    tempUv = new Vector2();
    tempLight = new Color();
    tempDark = new Color();
    skeleton;
    state;
    zOffset = 0.1;
    batches = new Array();
    materialFactory;
    nextBatchIndex = 0;
    clipper = new SkeletonClipping();
    static QUAD_TRIANGLES = [0, 1, 2, 2, 3, 0];
    static VERTEX_SIZE = 2 + 2 + 4;
    vertexSize = 2 + 2 + 4;
    twoColorTint;
    vertices = Utils.newFloatArray(1024);
    tempColor = new Color();
    tempDarkColor = new Color();
    _castShadow = false;
    _receiveShadow = false;
    constructor(skeletonDataOrConfiguration, materialCustomizer = () => { }) {
        super();
        if (!('skeletonData' in skeletonDataOrConfiguration)) {
            const materialFactory = () => {
                const parameters = { ...SkeletonMesh.DEFAULT_MATERIAL_PARAMETERS };
                materialCustomizer(parameters);
                return new THREE.MeshBasicMaterial(parameters);
            };
            skeletonDataOrConfiguration = {
                skeletonData: skeletonDataOrConfiguration,
                materialFactory,
            };
        }
        this.twoColorTint = skeletonDataOrConfiguration.twoColorTint ?? true;
        if (this.twoColorTint) {
            this.vertexSize += 4;
        }
        this.materialFactory = skeletonDataOrConfiguration.materialFactory ?? (() => new THREE.MeshBasicMaterial(SkeletonMesh.DEFAULT_MATERIAL_PARAMETERS));
        this.skeleton = new Skeleton(skeletonDataOrConfiguration.skeletonData);
        let animData = new AnimationStateData(skeletonDataOrConfiguration.skeletonData);
        this.state = new AnimationState(animData);
        Object.defineProperty(this, 'castShadow', {
            get: () => this._castShadow,
            set: (value) => {
                this._castShadow = value;
                this.traverse((child) => {
                    if (child instanceof MeshBatcher) {
                        child.castShadow = value;
                    }
                });
            },
        });
        Object.defineProperty(this, 'receiveShadow', {
            get: () => this._receiveShadow,
            set: (value) => {
                this._receiveShadow = value;
                // Propagate to children
                this.traverse((child) => {
                    if (child instanceof MeshBatcher) {
                        child.receiveShadow = value;
                    }
                });
            },
        });
    }
    update(deltaTime) {
        let state = this.state;
        let skeleton = this.skeleton;
        state.update(deltaTime);
        state.apply(skeleton);
        skeleton.update(deltaTime);
        skeleton.updateWorldTransform(Physics.update);
        this.updateGeometry();
    }
    dispose() {
        for (var i = 0; i < this.batches.length; i++) {
            this.batches[i].dispose();
        }
    }
    clearBatches() {
        for (var i = 0; i < this.batches.length; i++) {
            this.batches[i].clear();
            this.batches[i].visible = false;
        }
        this.nextBatchIndex = 0;
    }
    nextBatch() {
        if (this.batches.length == this.nextBatchIndex) {
            let batch = new MeshBatcher(MeshBatcher.MAX_VERTICES, this.materialFactory, this.twoColorTint);
            batch.castShadow = this._castShadow;
            batch.receiveShadow = this._receiveShadow;
            this.add(batch);
            this.batches.push(batch);
        }
        let batch = this.batches[this.nextBatchIndex++];
        batch.visible = true;
        return batch;
    }
    updateGeometry() {
        this.clearBatches();
        let tempLight = this.tempLight;
        let tempDark = this.tempDark;
        let clipper = this.clipper;
        let vertices = this.vertices;
        let triangles = null;
        let uvs = null;
        let drawOrder = this.skeleton.drawOrder;
        let batch = this.nextBatch();
        batch.begin();
        let z = 0;
        let zOffset = this.zOffset;
        for (let i = 0, n = drawOrder.length; i < n; i++) {
            let vertexSize = clipper.isClipping() ? 2 : this.vertexSize;
            let slot = drawOrder[i];
            if (!slot.bone.active) {
                clipper.clipEndWithSlot(slot);
                continue;
            }
            let attachment = slot.getAttachment();
            let attachmentColor;
            let texture;
            let numFloats = 0;
            if (attachment instanceof RegionAttachment) {
                let region = attachment;
                attachmentColor = region.color;
                vertices = this.vertices;
                numFloats = vertexSize * 4;
                region.computeWorldVertices(slot, vertices, 0, vertexSize);
                triangles = SkeletonMesh.QUAD_TRIANGLES;
                uvs = region.uvs;
                texture = region.region.texture;
            }
            else if (attachment instanceof MeshAttachment) {
                let mesh = attachment;
                attachmentColor = mesh.color;
                vertices = this.vertices;
                numFloats = (mesh.worldVerticesLength >> 1) * vertexSize;
                if (numFloats > vertices.length) {
                    vertices = this.vertices = Utils.newFloatArray(numFloats);
                }
                mesh.computeWorldVertices(slot, 0, mesh.worldVerticesLength, vertices, 0, vertexSize);
                triangles = mesh.triangles;
                uvs = mesh.uvs;
                texture = mesh.region.texture;
            }
            else if (attachment instanceof ClippingAttachment) {
                let clip = attachment;
                clipper.clipStart(slot, clip);
                continue;
            }
            else {
                clipper.clipEndWithSlot(slot);
                continue;
            }
            if (texture != null) {
                let skeleton = slot.bone.skeleton;
                let skeletonColor = skeleton.color;
                let slotColor = slot.color;
                let alpha = skeletonColor.a * slotColor.a * attachmentColor.a;
                let color = this.tempColor;
                color.set(skeletonColor.r * slotColor.r * attachmentColor.r * alpha, skeletonColor.g * slotColor.g * attachmentColor.g * alpha, skeletonColor.b * slotColor.b * attachmentColor.b * alpha, alpha);
                let darkColor = this.tempDarkColor;
                if (!slot.darkColor)
                    darkColor.set(0, 0, 0, 1);
                else {
                    darkColor.r = slot.darkColor.r * alpha;
                    darkColor.g = slot.darkColor.g * alpha;
                    darkColor.b = slot.darkColor.b * alpha;
                    darkColor.a = 1;
                }
                let finalVertices;
                let finalVerticesLength;
                let finalIndices;
                let finalIndicesLength;
                if (clipper.isClipping()) {
                    clipper.clipTriangles(vertices, triangles, triangles.length, uvs, color, tempLight, this.twoColorTint);
                    let clippedVertices = clipper.clippedVertices;
                    let clippedTriangles = clipper.clippedTriangles;
                    finalVertices = clippedVertices;
                    finalVerticesLength = clippedVertices.length;
                    finalIndices = clippedTriangles;
                    finalIndicesLength = clippedTriangles.length;
                }
                else {
                    let verts = vertices;
                    if (!this.twoColorTint) {
                        for (let v = 2, u = 0, n = numFloats; v < n; v += vertexSize, u += 2) {
                            verts[v] = color.r;
                            verts[v + 1] = color.g;
                            verts[v + 2] = color.b;
                            verts[v + 3] = color.a;
                            verts[v + 4] = uvs[u];
                            verts[v + 5] = uvs[u + 1];
                        }
                    }
                    else {
                        for (let v = 2, u = 0, n = numFloats; v < n; v += vertexSize, u += 2) {
                            verts[v] = color.r;
                            verts[v + 1] = color.g;
                            verts[v + 2] = color.b;
                            verts[v + 3] = color.a;
                            verts[v + 4] = uvs[u];
                            verts[v + 5] = uvs[u + 1];
                            verts[v + 6] = darkColor.r;
                            verts[v + 7] = darkColor.g;
                            verts[v + 8] = darkColor.b;
                            verts[v + 9] = darkColor.a;
                        }
                    }
                    finalVertices = vertices;
                    finalVerticesLength = numFloats;
                    finalIndices = triangles;
                    finalIndicesLength = triangles.length;
                }
                if (finalVerticesLength == 0 || finalIndicesLength == 0) {
                    clipper.clipEndWithSlot(slot);
                    continue;
                }
                // Start new batch if this one can't hold vertices/indices
                if (!batch.canBatch(finalVerticesLength / this.vertexSize, finalIndicesLength)) {
                    batch.end();
                    batch = this.nextBatch();
                    batch.begin();
                }
                const slotBlendMode = slot.data.blendMode;
                const slotTexture = texture.texture;
                const materialGroup = batch.findMaterialGroup(slotTexture, slotBlendMode);
                batch.addMaterialGroup(finalIndicesLength, materialGroup);
                batch.batch(finalVertices, finalVerticesLength, finalIndices, finalIndicesLength, z);
                z += zOffset;
            }
            clipper.clipEndWithSlot(slot);
        }
        clipper.clipEnd();
        batch.end();
    }
}
