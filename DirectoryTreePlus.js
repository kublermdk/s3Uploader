const dirTree = require("directory-tree");
const _ = require('lodash');

class DirectoryTreePlus {

    DirTree = dirTree;
    localFolder = '';
    basePath = ''; // The localFolder but in the normalised dirTree form

    settings = {};

    filesHash = {};

    TYPE_DIRECTORY = 'directory';
    TYPE_FILE = 'file';

    MERGE_TYPE_OVERRIDE = 'override';
    MERGE_TYPE_MERGE = 'merge';
    MERGE_TYPE_SKIP = 'skip';


    dirTreeOptions = {
        attributes: ['mode', 'mtime', 'mtimeMs'],
        normalizePath: true, // So we can use the same paths for S3
    }

    defaultSettings = {

        recurseFolder: true,
        excludeFiles: [],
        extensions: null, // e.g new RegExp('\\.(' + process.env.FILE_EXTENSIONS + ')$');
        ignoreHiddenFiles: true, // Especially useful for checking folders that have Rsync files being received
        dirTreeOptions: {},
    }

    constructor(localFolder, settings = {}) {
        this.localFolder = localFolder;
        this.settings = _.merge({}, this.defaultSettings, settings);
        this.dirTreeOptions = _.merge({}, this.dirTreeOptions, this.settings.dirTreeOptions); // Add in any custom dirTreeOptions
    };


    getUnprocessedDirTreeEntries() {
        return this.DirTree(this.localFolder, this.dirTreeOptions);
    }

    /**
     * Actually call DirTree
     *
     * This is the first call
     */
    getTreeEntries = () => {

        return this.addBasePathToRecursiveEntries(this.filterOutRecursiveDirectoriesIfNeeded(this.getUnprocessedDirTreeEntries()));
    }

    // e.g: The filteredTree is:  {
    //   path: 'C:/Images/2020-12-31st New Years Eve',
    //   name: '2020-12-31st New Years Eve',
    //   mode: 16822,
    //   mtime: 2021-01-03T15:25:35.383Z,
    //   children: [
    //     {
    //       path: 'C:/Images/2020-12-31st New Years Eve/Exported',
    //       name: 'Exported',
    //       mode: 16822,
    //       mtime: 2021-01-03T15:28:18.868Z,
    //       children: [Array],
    //       size: 12016525345,
    //       type: 'directory'
    //     },
    //     {
    //       path: "C:/Images/2020-12-31st New Years Eve/v1-0005.mp4",
    //       name: 'v1-0005.mp4',
    //       size: 2875052099,
    //       extension: '.mp4',
    //       type: 'file',
    //       mode: 33206,
    //       mtime: 2021-01-03T15:20:19.868Z
    //     }
    //   ],
    //   size: 12016525345,
    //   type: 'directory'
    // }

    addBasePathToRecursiveEntries = (unfilteredTree, isBase = true) => {

        if (!unfilteredTree) {
            // Nothing to filter
            return unfilteredTree;
        }

        if (true === isBase) {
            // We want the base path only on the first entry, not on others
            this.basePath = unfilteredTree.path;
        }

        unfilteredTree.basePath = this.basePath;
        // console.debug("addBasePathToEntries(): ", {basePath: this.basePath, unfilteredTree});

        if (_.get(unfilteredTree, 'children.length', 0) > 0) {

            _.each(unfilteredTree.children, (treeEntry, childIndex) => {
                // Adding in the basePath
                unfilteredTree.children[childIndex].basePath = this.basePath;
                if (treeEntry.type === this.TYPE_DIRECTORY) {
                    // Recursive over the folders
                    unfilteredTree.children[childIndex] = this.addBasePathToRecursiveEntries(treeEntry, false);
                }
            });
            // console.debug("addBasePathToEntries() unfilteredTree.children", unfilteredTree.children); // View the children in the response
        }

        return unfilteredTree;
    }

    returnFlattenedTreeEntries = (tree, onlyFiles = true, basePath = null) => {
        // Return a list of the tree entries as a single array
        if (_.isEmpty(tree)) {
            return [];
        }
        let entries = [];

        if (!_.isArray(tree)) {
            // Been given an entry object not an array of entry objects
            if (null === basePath) {
                basePath = tree.path;
            }
            tree.basePath = basePath;

            if (false === onlyFiles || true === onlyFiles && 'file' === tree.type) {
                entries.push(_.omit(tree, 'children')); // Remove the children entry
            }

        } else {
            // Not expecting an array to be provided, only a tree Entry (e.g with a path, type, etc..
            console.warn("#########################################\nNOT AN ARRAY\n##################################\n", {
                tree,
                onlyFiles
            });
        }
        // console.log("entries after omit local: ", {entries, onlyFiles});
        if (!_.isEmpty(tree.children)) {
            _.forEach(tree.children, treeEntry => {
                if (_.get(treeEntry, 'children.length') > 0) {
                    // console.log("treeEntry has children: ", treeEntry);
                    // Add in the recursive entries
                    entries = entries.concat(this.returnFlattenedTreeEntries(treeEntry, onlyFiles, basePath));
                } else if (false === onlyFiles || true === onlyFiles && 'file' === treeEntry.type) {
                    treeEntry.basePath = basePath; // Add in the BasePath
                    entries.push(_.omit(treeEntry, 'children'));
                    // console.log("treeEntry hasn't children but is to be included: ", treeEntry);
                }
            });
        }
        return entries;
    }


    /**
     * Add Entries To Files Hash
     *
     * @param flattenedTreeEntries {array}
     * @param overrideMergeOrSkipIfExisting {string}
     */
    addFlattenedEntriesToFilesHash = (flattenedTreeEntries, overrideMergeOrSkipIfExisting = this.MERGE_TYPE_MERGE) => {
        _.forEach(flattenedTreeEntries, (treeEntry, treeEntryIndex) => {
            if (treeEntry.type === this.TYPE_FILE) {
                // Only process Files not directories
                this.addTreeEntryToHash(treeEntry, overrideMergeOrSkipIfExisting)
            }
        });
    }

    /**
     * Add Tree Entry To Files Hash
     *
     * @param treeEntry
     * @param overrideMergeOrSkipIfExisting accepts 'override', 'merge' (the default) or 'skip'
     * @returns {boolean}
     */
    addTreeEntryToHash(treeEntry, overrideMergeOrSkipIfExisting = this.MERGE_TYPE_MERGE) {
        // The path is the hash
        if (_.isEmpty(treeEntry) || _.isEmpty(treeEntry.path)) {
            return null;
        }
        if (_.isEmpty(this.filesHash[treeEntry.path]) || 'override' === overrideMergeOrSkipIfExisting) {
            this.filesHash[treeEntry.path] = treeEntry;
            return true;
        } else if ('skip' === overrideMergeOrSkipIfExisting) {
            return false;
        } else if ('merge' === overrideMergeOrSkipIfExisting) {
            // The entry already exists, merge
            this.filesHash[treeEntry.path] = _.merge(this.filesHash[treeEntry.path], treeEntry);
            return true;
        }
    }


    filterOutRecursiveDirectoriesIfNeeded = (filteredTree) => {

        if (true === this.settings.recurseFolder && _.get(filteredTree, 'children.length') > 0) {
            filteredTree.children = _.filter(filteredTree.children, treeEntry => {
                return treeEntry.type !== 'directory';
            });
        }
        return filteredTree;
    }

    treeOutput = (filteredTree, indents = '') => {
        let output = '';

        _.each(filteredTree, treeEntry => {
            // console.debug(treeEntry);
            output += indents + (treeEntry.type === 'file' ? treeEntry.name : `[ ${treeEntry.name} ]`) + ' ' + fileSizeReadable(treeEntry.size) + "\n"
            if (treeEntry.type === 'directory' && _.get(treeEntry, 'children.length') > 0) {
                output += this.treeOutput(treeEntry.children, `${indents} - `); // Recursive call
            }
        });
        return output;
    }


//
// // --------------------------------
// //   Workout Dir Tree Options
// // --------------------------------
//     let dirTreeOptions = {
//         attributes: ['mode', 'mtime', 'mtimeMs'],
//         normalizePath: true, // So we can use the same paths for S3
//     };
//
//     if (process.env.FILE_EXTENSIONS) {
//     dirTreeOptions.extensions = new RegExp('\\.(' + process.env.FILE_EXTENSIONS + ')$');
// }
//
// if (ignoreSelf) {
//     // @todo: Add ignore for the local files
// }
//
// if (localExclude) {
//     dirTreeOptions.exclude = localExclude;
// }
//
// console.debug('dirTreeOptions: ', dirTreeOptions);


}


module.exports = DirectoryTreePlus;
