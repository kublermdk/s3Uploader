const os = require('os');
const fs = require('fs');
// const fsPromises = fs.promises;

const DirectoryTree = require('../DirectoryTreePlus.js');
const DeferredPromise = require('../DeferredPromise.js');
const path = require('path');
const {sep} = require('path');
const tmpDir = os.tmpdir();
const _ = require('lodash');
require('dotenv').config(); // Load env vars https://www.npmjs.com/package/dotenv
const dirTree = require("directory-tree"); // The base we are building upon

// You'll likely want to  `npm install jest --global` to be able to use `npm run test`
// During active development you'll also want to run:
// > npm run test-watch

// Check https://jestjs.io/docs/en/getting-started.html for more information on using Jest tests

// -- Dir Tree init
let localResourcesFolder = path.join(__dirname, 'resources');
// e.g C:\s3uploader\tests\resources
let dirTreeOptions = {
    attributes: ['mode', 'mtime', 'mtimeMs'],
    normalizePath: true, // So we can use the same paths for S3
};


// ====================================================================================
//     Directory Tree Plus
// ====================================================================================


/**
 * Wait Time
 *
 * Wait a certain amount of time then resolve the promise, good for
 * @example await waitTime(1);
 * @example await waitTime(100);
 * @param waitMs
 * @returns {Promise<unknown>}
 */
let waitTime = (waitMs = 1) => {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve(true);
        }, waitMs);
    });
}

let waitImmediate = () => {
    return new Promise((resolve, reject) => {
        setImmediate(() => {
            resolve(true);
        });
    });
}

let expectedBaseDirTree = {
    path: expect.any(String),
    name: "resources",
    mode: expect.any(Number),
    mtime: expect.anything(),
    mtimeMs: expect.any(Number),
    size: 43,
    type: "directory",
    children:
        [
            {
                path: expect.any(String),
                name: "1x1.gif",
                size: 43,
                extension: ".gif",
                type: "file",
                mode: expect.any(Number),
                mtime: expect.anything(),
                mtimeMs: expect.any(Number)
            }],
}

describe('Directory Tree Plus', () => {

    test('works without extra settings', () => {

        let directoryTree = new DirectoryTree(localResourcesFolder);
        expect(directoryTree).toBeDefined();
        expect(directoryTree.DirTree).toBeDefined();
        expect(directoryTree.localFolder).toEqual(localResourcesFolder);
        expect(directoryTree.settings).toEqual(directoryTree.defaultSettings);
        expect(directoryTree.filesHash).toEqual({});
        let treeEntries = directoryTree.getTreeEntries();
        expect(treeEntries).toEqual(_.merge({}, expectedBaseDirTree, {
            basePath: expectedBaseDirTree.path,
            children: [{basePath: expectedBaseDirTree.path}]
        }));
        // basePath: expect.any(String), // Inserted by our own code, not by dirTree
    });
});


describe('Directory Tree Plus temp folder', () => {

    let tempFolder = fs.mkdtempSync(`${tmpDir}${sep}`);
    afterEach(() => {
        if (!_.isEmpty(tempFolder)) {
            console.log("Removing the tempFolder: ", tempFolder);
            fs.rmSync(tempFolder, {recursive: true, maxRetries: 1});
        }
    });
    test('getFlattenedTreeEntries', () => {

        let extendedTempFolder = path.join(tempFolder, `another${sep}test${sep}folder`);
        console.debug("Created extendedTempFolder: ", extendedTempFolder);
        fs.mkdirSync(extendedTempFolder, {recursive: true});
        fs.copyFileSync(path.join(localResourcesFolder, '1x1.gif'), path.join(extendedTempFolder, '1x1.gif'));


        let directoryTree = new DirectoryTree(tempFolder);
        let dirTreeEntries = directoryTree.getUnprocessedDirTreeEntries();
        // Expecting 4 children then the file
        expect(_.get(dirTreeEntries, 'children.0.children.0.children.0.children.0.name')).toEqual("1x1.gif");
        expect(directoryTree.returnFlattenedTreeEntries(dirTreeEntries)).toEqual([
            {
                "extension": ".gif",
                "mode": expect.anything(),
                "mtime": expect.anything(),
                "mtimeMs": expect.anything(),
                "name": "1x1.gif",
                "path": expect.any(String),
                "size": 43,
                "type": "file"
            }
        ]);
        expect(directoryTree.returnFlattenedTreeEntries(dirTreeEntries, false).length).toEqual(5);

    });

});


// ====================================================================================
//     Dir Tree
// ====================================================================================
describe('Dir Tree', () => {


    let dirTreeResponse = dirTree(localResourcesFolder, dirTreeOptions);

    // e.g {path:"C:/s3uploader/tests/resources",name:"resources",mode:16822,mtime:"2021-01-28T14:38:38.045Z",mtimeMs:1611844718044.9944,children:[{path:"C:/s3uploader/tests/resources/1x1.gif",name:"1x1.gif",size:43,extension:".gif",type:"file",mode:33206,mtime:"2021-01-09T02:47:30.290Z",mtimeMs:1610160450289.9504}],size:43,type:"directory"}

    test('works', () => {

        // console.debug("The dirTreeResponse is: ", JSON.stringify(dirTreeResponse));
        expect(localResourcesFolder).toMatch(/resources$/);
        expect(dirTreeResponse).toBeDefined();
        expect(dirTreeResponse).toEqual({
                path: expect.any(String),
                name: "resources",
                mode: expect.any(Number),
                mtime: expect.anything(),
                mtimeMs: expect.any(Number),
                size: 43,
                type: "directory",
                children:
                    [
                        {
                            path: expect.any(String),
                            name: "1x1.gif",
                            size: 43,
                            extension: ".gif",
                            type: "file",
                            mode: expect.any(Number),
                            mtime: expect.anything(),
                            mtimeMs: expect.any(Number)
                        }],
            }
        );
    });
});
