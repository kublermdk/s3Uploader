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
            // console.log("Removing the tempFolder: ", tempFolder);
            fs.rmSync(tempFolder, {recursive: true, maxRetries: 1});
        }
    });
    test('getFlattenedTreeEntries', () => {

        let extendedTempFolder = path.join(tempFolder, `another${sep}test${sep}folder`);
        // console.debug("Created extendedTempFolder: ", extendedTempFolder);
        fs.mkdirSync(extendedTempFolder, {recursive: true});
        fs.copyFileSync(path.join(localResourcesFolder, '1x1.gif'), path.join(extendedTempFolder, '1x1.gif'));


        let directoryTree = new DirectoryTree(tempFolder);
        let dirTreeEntries = directoryTree.getUnprocessedDirTreeEntries();
        // Expecting 4 children then the file
        expect(_.get(dirTreeEntries, 'children.0.children.0.children.0.children.0.name')).toEqual("1x1.gif");
        let expectedEntry = {
            "extension": ".gif",
            "mode": expect.anything(),
            "mtime": expect.anything(),
            "mtimeMs": expect.anything(),
            "name": "1x1.gif",
            "path": expect.any(String),
            "basePath": expect.any(String),
            "size": 43,
            "type": "file"
        };
        let flattenedDirTreeEntriesWithOnlyFile = directoryTree.returnFlattenedTreeEntries(dirTreeEntries)
        let flattenedDirTreeEntriesWithDirectories = directoryTree.returnFlattenedTreeEntries(dirTreeEntries, false);
        expect(flattenedDirTreeEntriesWithOnlyFile).toEqual([expectedEntry]);
        let treeEntry = flattenedDirTreeEntriesWithOnlyFile[0];

        // -- Returns the full tree entries, with the directories
        expect(flattenedDirTreeEntriesWithDirectories.length).toEqual(5);
        expect(directoryTree.filesHash).toEqual({});


        // -- Add the file to the hash
        directoryTree.addFlattenedEntriesToFilesHash(flattenedDirTreeEntriesWithDirectories); // Should only add the files
        expect(_.keys(directoryTree.filesHash).length).toEqual(1);
        let filePath = treeEntry.path;
        expect(directoryTree.filesHash).toEqual({[filePath]: expectedEntry});

        // -- Test Merge
        treeEntry.randomNewKey = 'random Value';
        let addEntry = directoryTree.addTreeEntryToHash(treeEntry, directoryTree.MERGE_TYPE_MERGE);
        expect(addEntry).toEqual(true);
        expect(directoryTree.filesHash).toEqual({
            [filePath]: _.merge({randomNewKey: 'random Value'}, expectedEntry)
        });

        // -- Merges in an a nearly empty entry (the path needs to be set the same)
        let otherObject = {path: treeEntry.path, test: 'things'};
        addEntry = directoryTree.addTreeEntryToHash(otherObject, directoryTree.MERGE_TYPE_MERGE);
        expect(addEntry).toEqual(true);
        expect(directoryTree.filesHash).toEqual({
            [filePath]: _.merge({randomNewKey: 'random Value', test: 'things'}, expectedEntry)
        });

        // -- Overrides (replaces) an existing entry
        addEntry = directoryTree.addTreeEntryToHash(otherObject, directoryTree.MERGE_TYPE_OVERRIDE);
        expect(addEntry).toEqual(true);
        expect(directoryTree.filesHash).toEqual({
            [filePath]: otherObject
        });

        // -- Skips an existing entry
        addEntry = directoryTree.addTreeEntryToHash(treeEntry, directoryTree.MERGE_TYPE_SKIP);
        expect(addEntry).toEqual(false);
        expect(directoryTree.filesHash).toEqual({
            [filePath]: otherObject
        });

        let randomObject = {
            path: 'random new path',
            testing: 'the stairs are down'
        };
        // -- Skip still adds a new entry
        addEntry = directoryTree.addTreeEntryToHash(randomObject, directoryTree.MERGE_TYPE_SKIP);
        expect(addEntry).toEqual(true);
        expect(directoryTree.filesHash).toEqual({
            [filePath]: otherObject,
            [randomObject.path]: randomObject
        });

        // -- Doesn't add invalid entries
        addEntry = directoryTree.addTreeEntryToHash('invalid');
        expect(addEntry).toEqual(null);
        expect(directoryTree.filesHash).toEqual({
            [filePath]: otherObject,
            [randomObject.path]: randomObject
        });


        // -- Get just the new files
        let noNewEntries = directoryTree.getFlattenedEntriesOfOnlyNewFiles();
        expect(noNewEntries).toEqual([]);
        expect(_.keys(directoryTree.filesHash).length).toEqual(2); // Only the previous entries

        let newFilePath = path.join(`${tempFolder}${sep}another${sep}test`, 'tiny.gif');
        // Add a new file (well the same file as before but in a new path. We don't have hashing based dedupe, it's just based on the path
        fs.copyFileSync(path.join(localResourcesFolder, '1x1.gif'), newFilePath);

        let newEntry = directoryTree.getFlattenedEntriesOfOnlyNewFiles(); // Should pickup the new entry
        // Just the new entry, not all the files
        expect(newEntry).toEqual([
            _.merge({}, expectedEntry, {"name": "tiny.gif"})
        ]);

        expect(_.keys(directoryTree.filesHash).length).toEqual(3); // Now a new entry
        // console.log("The filesHash contains: ", _.keys(directoryTree.filesHash));
        /* e.g
        The filesHash contains:  [
          '/tmp/2Y7s3w/another/test/folder/1x1.gif',
          'random new path',
          '/tmp/2Y7s3w/another/test/tiny.gif'
        ]
         */

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
