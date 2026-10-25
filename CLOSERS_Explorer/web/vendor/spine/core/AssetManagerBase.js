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
import { TextureAtlas } from "./TextureAtlas.js";
export class AssetManagerBase {
    pathPrefix = "";
    textureLoader;
    downloader;
    cache;
    errors = {};
    toLoad = 0;
    loaded = 0;
    constructor(textureLoader, pathPrefix = "", downloader = new Downloader(), cache = new AssetCache()) {
        this.textureLoader = textureLoader;
        this.pathPrefix = pathPrefix;
        this.downloader = downloader;
        this.cache = cache;
    }
    start(path) {
        this.toLoad++;
        return this.pathPrefix + path;
    }
    success(callback, path, asset) {
        this.toLoad--;
        this.loaded++;
        this.cache.assets[path] = asset;
        this.cache.assetsRefCount[path] = (this.cache.assetsRefCount[path] || 0) + 1;
        if (callback)
            callback(path, asset);
    }
    error(callback, path, message) {
        this.toLoad--;
        this.loaded++;
        this.errors[path] = message;
        if (callback)
            callback(path, message);
    }
    loadAll() {
        let promise = new Promise((resolve, reject) => {
            let check = () => {
                if (this.isLoadingComplete()) {
                    if (this.hasErrors())
                        reject(this.errors);
                    else
                        resolve(this);
                    return;
                }
                requestAnimationFrame(check);
            };
            requestAnimationFrame(check);
        });
        return promise;
    }
    setRawDataURI(path, data) {
        this.downloader.rawDataUris[this.pathPrefix + path] = data;
    }
    loadBinary(path, success = () => { }, error = () => { }) {
        path = this.start(path);
        if (this.reuseAssets(path, success, error))
            return;
        this.cache.assetsLoaded[path] = new Promise((resolve, reject) => {
            this.downloader.downloadBinary(path, (data) => {
                this.success(success, path, data);
                resolve(data);
            }, (status, responseText) => {
                const errorMsg = `Couldn't load binary ${path}: status ${status}, ${responseText}`;
                this.error(error, path, errorMsg);
                reject(errorMsg);
            });
        });
    }
    loadText(path, success = () => { }, error = () => { }) {
        path = this.start(path);
        this.downloader.downloadText(path, (data) => {
            this.success(success, path, data);
        }, (status, responseText) => {
            this.error(error, path, `Couldn't load text ${path}: status ${status}, ${responseText}`);
        });
    }
    loadJson(path, success = () => { }, error = () => { }) {
        path = this.start(path);
        if (this.reuseAssets(path, success, error))
            return;
        this.cache.assetsLoaded[path] = new Promise((resolve, reject) => {
            this.downloader.downloadJson(path, (data) => {
                this.success(success, path, data);
                resolve(data);
            }, (status, responseText) => {
                const errorMsg = `Couldn't load JSON ${path}: status ${status}, ${responseText}`;
                this.error(error, path, errorMsg);
                reject(errorMsg);
            });
        });
    }
    reuseAssets(path, success = () => { }, error = () => { }) {
        const loadedStatus = this.cache.assetsLoaded[path];
        const alreadyExistsOrLoading = loadedStatus !== undefined;
        if (alreadyExistsOrLoading) {
            this.cache.assetsLoaded[path] = loadedStatus
                .then(data => {
                // necessary when user preloads an image into the cache.
                // texture loader is not avaiable in the cache, so we transform in GLTexture at first use
                data = (data instanceof Image || data instanceof ImageBitmap) ? this.textureLoader(data) : data;
                this.success(success, path, data);
                return data;
            })
                .catch(errorMsg => this.error(error, path, errorMsg));
        }
        return alreadyExistsOrLoading;
    }
    loadTexture(path, success = () => { }, error = () => { }) {
        path = this.start(path);
        if (this.reuseAssets(path, success, error))
            return;
        this.cache.assetsLoaded[path] = new Promise((resolve, reject) => {
            let isBrowser = !!(typeof window !== 'undefined' && typeof navigator !== 'undefined' && window.document);
            let isWebWorker = !isBrowser; // && typeof importScripts !== 'undefined';
            if (isWebWorker) {
                fetch(path, { mode: "cors" }).then((response) => {
                    if (response.ok)
                        return response.blob();
                    const errorMsg = `Couldn't load image: ${path}`;
                    this.error(error, path, `Couldn't load image: ${path}`);
                    reject(errorMsg);
                }).then((blob) => {
                    return blob ? createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" }) : null;
                }).then((bitmap) => {
                    if (bitmap) {
                        const texture = this.createTexture(path, bitmap);
                        this.success(success, path, texture);
                        resolve(texture);
                    }
                    ;
                });
            }
            else {
                let image = new Image();
                image.crossOrigin = "anonymous";
                image.onload = () => {
                    const texture = this.createTexture(path, image);
                    this.success(success, path, texture);
                    resolve(texture);
                };
                image.onerror = () => {
                    const errorMsg = `Couldn't load image: ${path}`;
                    this.error(error, path, errorMsg);
                    reject(errorMsg);
                };
                if (this.downloader.rawDataUris[path])
                    path = this.downloader.rawDataUris[path];
                image.src = path;
            }
        });
    }
    loadTextureAtlas(path, success = () => { }, error = () => { }, fileAlias) {
        let index = path.lastIndexOf("/");
        let parent = index >= 0 ? path.substring(0, index + 1) : "";
        path = this.start(path);
        if (this.reuseAssets(path, success, error))
            return;
        this.cache.assetsLoaded[path] = new Promise((resolve, reject) => {
            this.downloader.downloadText(path, (atlasText) => {
                try {
                    const atlas = this.createTextureAtlas(path, atlasText);
                    let toLoad = atlas.pages.length, abort = false;
                    if (toLoad === 0) {
                        this.success(success, path, atlas);
                        resolve(atlas);
                        return;
                    }
                    for (let page of atlas.pages) {
                        this.loadTexture(!fileAlias ? parent + page.name : fileAlias[page.name], (imagePath, texture) => {
                            if (!abort) {
                                page.setTexture(texture);
                                if (--toLoad == 0) {
                                    this.success(success, path, atlas);
                                    resolve(atlas);
                                }
                            }
                        }, (imagePath, message) => {
                            if (!abort) {
                                const errorMsg = `Couldn't load texture ${path} page image: ${imagePath}`;
                                this.error(error, path, errorMsg);
                                reject(errorMsg);
                            }
                            abort = true;
                        });
                    }
                }
                catch (e) {
                    const errorMsg = `Couldn't parse texture atlas ${path}: ${e.message}`;
                    this.error(error, path, errorMsg);
                    reject(errorMsg);
                }
            }, (status, responseText) => {
                const errorMsg = `Couldn't load texture atlas ${path}: status ${status}, ${responseText}`;
                this.error(error, path, errorMsg);
                reject(errorMsg);
            });
        });
    }
    loadTextureAtlasButNoTextures(path, success = () => { }, error = () => { }, fileAlias) {
        path = this.start(path);
        if (this.reuseAssets(path, success, error))
            return;
        this.cache.assetsLoaded[path] = new Promise((resolve, reject) => {
            this.downloader.downloadText(path, (atlasText) => {
                try {
                    const atlas = this.createTextureAtlas(path, atlasText);
                    this.success(success, path, atlas);
                    resolve(atlas);
                }
                catch (e) {
                    const errorMsg = `Couldn't parse texture atlas ${path}: ${e.message}`;
                    this.error(error, path, errorMsg);
                    reject(errorMsg);
                }
            }, (status, responseText) => {
                const errorMsg = `Couldn't load texture atlas ${path}: status ${status}, ${responseText}`;
                this.error(error, path, errorMsg);
                reject(errorMsg);
            });
        });
    }
    // Promisified versions of load function
    async loadBinaryAsync(path) {
        return new Promise((resolve, reject) => {
            this.loadBinary(path, (_, binary) => resolve(binary), (_, message) => reject(message));
        });
    }
    async loadJsonAsync(path) {
        return new Promise((resolve, reject) => {
            this.loadJson(path, (_, object) => resolve(object), (_, message) => reject(message));
        });
    }
    async loadTextureAsync(path) {
        return new Promise((resolve, reject) => {
            this.loadTexture(path, (_, texture) => resolve(texture), (_, message) => reject(message));
        });
    }
    async loadTextureAtlasAsync(path) {
        return new Promise((resolve, reject) => {
            this.loadTextureAtlas(path, (_, atlas) => resolve(atlas), (_, message) => reject(message));
        });
    }
    async loadTextureAtlasButNoTexturesAsync(path) {
        return new Promise((resolve, reject) => {
            this.loadTextureAtlasButNoTextures(path, (_, atlas) => resolve(atlas), (_, message) => reject(message));
        });
    }
    setCache(cache) {
        this.cache = cache;
    }
    get(path) {
        return this.cache.assets[this.pathPrefix + path];
    }
    require(path) {
        path = this.pathPrefix + path;
        let asset = this.cache.assets[path];
        if (asset)
            return asset;
        let error = this.errors[path];
        throw Error("Asset not found: " + path + (error ? "\n" + error : ""));
    }
    remove(path) {
        path = this.pathPrefix + path;
        let asset = this.cache.assets[path];
        if (asset.dispose)
            asset.dispose();
        delete this.cache.assets[path];
        delete this.cache.assetsRefCount[path];
        delete this.cache.assetsLoaded[path];
        return asset;
    }
    removeAll() {
        for (let path in this.cache.assets) {
            let asset = this.cache.assets[path];
            if (asset.dispose)
                asset.dispose();
        }
        this.cache.assets = {};
        this.cache.assetsLoaded = {};
        this.cache.assetsRefCount = {};
    }
    isLoadingComplete() {
        return this.toLoad == 0;
    }
    getToLoad() {
        return this.toLoad;
    }
    getLoaded() {
        return this.loaded;
    }
    dispose() {
        this.removeAll();
    }
    // dispose asset only if it's not used by others
    disposeAsset(path) {
        const asset = this.cache.assets[path];
        if (asset instanceof TextureAtlas) {
            asset.dispose();
            return;
        }
        this.disposeAssetInternal(path);
    }
    hasErrors() {
        return Object.keys(this.errors).length > 0;
    }
    getErrors() {
        return this.errors;
    }
    disposeAssetInternal(path) {
        if (this.cache.assetsRefCount[path] > 0 && --this.cache.assetsRefCount[path] === 0) {
            return this.remove(path);
        }
    }
    createTextureAtlas(path, atlasText) {
        const atlas = new TextureAtlas(atlasText);
        atlas.dispose = () => {
            if (this.cache.assetsRefCount[path] <= 0)
                return;
            this.disposeAssetInternal(path);
            for (const page of atlas.pages) {
                page.texture?.dispose();
            }
        };
        return atlas;
    }
    createTexture(path, image) {
        const texture = this.textureLoader(image);
        const textureDispose = texture.dispose.bind(texture);
        texture.dispose = () => {
            if (this.disposeAssetInternal(path))
                textureDispose();
        };
        return texture;
    }
}
export class AssetCache {
    assets = {};
    assetsRefCount = {};
    assetsLoaded = {};
    static AVAILABLE_CACHES = new Map();
    static getCache(id) {
        const cache = AssetCache.AVAILABLE_CACHES.get(id);
        if (cache)
            return cache;
        const newCache = new AssetCache();
        AssetCache.AVAILABLE_CACHES.set(id, newCache);
        return newCache;
    }
    async addAsset(path, asset) {
        this.assetsLoaded[path] = Promise.resolve(asset);
        this.assets[path] = await asset;
    }
}
export class Downloader {
    callbacks = {};
    rawDataUris = {};
    dataUriToString(dataUri) {
        if (!dataUri.startsWith("data:")) {
            throw new Error("Not a data URI.");
        }
        let base64Idx = dataUri.indexOf("base64,");
        if (base64Idx != -1) {
            base64Idx += "base64,".length;
            return atob(dataUri.substr(base64Idx));
        }
        else {
            return dataUri.substr(dataUri.indexOf(",") + 1);
        }
    }
    base64ToUint8Array(base64) {
        var binary_string = window.atob(base64);
        var len = binary_string.length;
        var bytes = new Uint8Array(len);
        for (var i = 0; i < len; i++) {
            bytes[i] = binary_string.charCodeAt(i);
        }
        return bytes;
    }
    dataUriToUint8Array(dataUri) {
        if (!dataUri.startsWith("data:")) {
            throw new Error("Not a data URI.");
        }
        let base64Idx = dataUri.indexOf("base64,");
        if (base64Idx == -1)
            throw new Error("Not a binary data URI.");
        base64Idx += "base64,".length;
        return this.base64ToUint8Array(dataUri.substr(base64Idx));
    }
    downloadText(url, success, error) {
        if (this.start(url, success, error))
            return;
        const rawDataUri = this.rawDataUris[url];
        // we assume if a "." is included in a raw data uri, it is used to rewrite an asset URL
        if (rawDataUri && !rawDataUri.includes(".")) {
            try {
                this.finish(url, 200, this.dataUriToString(rawDataUri));
            }
            catch (e) {
                this.finish(url, 400, JSON.stringify(e));
            }
            return;
        }
        let request = new XMLHttpRequest();
        request.overrideMimeType("text/html");
        request.open("GET", rawDataUri ? rawDataUri : url, true);
        let done = () => {
            this.finish(url, request.status, request.responseText);
        };
        request.onload = done;
        request.onerror = done;
        request.send();
    }
    downloadJson(url, success, error) {
        this.downloadText(url, (data) => {
            success(JSON.parse(data));
        }, error);
    }
    downloadBinary(url, success, error) {
        if (this.start(url, success, error))
            return;
        const rawDataUri = this.rawDataUris[url];
        // we assume if a "." is included in a raw data uri, it is used to rewrite an asset URL
        if (rawDataUri && !rawDataUri.includes(".")) {
            try {
                this.finish(url, 200, this.dataUriToUint8Array(rawDataUri));
            }
            catch (e) {
                this.finish(url, 400, JSON.stringify(e));
            }
            return;
        }
        let request = new XMLHttpRequest();
        request.open("GET", rawDataUri ? rawDataUri : url, true);
        request.responseType = "arraybuffer";
        let onerror = () => {
            this.finish(url, request.status, request.response);
        };
        request.onload = () => {
            if (request.status == 200 || request.status == 0)
                this.finish(url, 200, new Uint8Array(request.response));
            else
                onerror();
        };
        request.onerror = onerror;
        request.send();
    }
    start(url, success, error) {
        let callbacks = this.callbacks[url];
        try {
            if (callbacks)
                return true;
            this.callbacks[url] = callbacks = [];
        }
        finally {
            callbacks.push(success, error);
        }
    }
    finish(url, status, data) {
        let callbacks = this.callbacks[url];
        delete this.callbacks[url];
        let args = status == 200 || status == 0 ? [data] : [status, data];
        for (let i = args.length - 1, n = callbacks.length; i < n; i += 2)
            callbacks[i].apply(null, args);
    }
}
