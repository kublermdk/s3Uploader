const dirTree = require("directory-tree");
const _ = require('lodash');

class DirectoryTreePlus {

    DirTree = dirTree;
    localFolder = '';
    basePath = ''; // The localFolder but in the normalised dirTree form

    settings = {};

    filesHash = {};

    typeDirectory = 'directory';
    typeFile = 'file';

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


    /**
     * Actually call DirTree
     *
     * This is the first call
     */
    getTreeEntries = () => {

        return this.addBasePathToEntries(this.filterOutRecursiveDirectoriesIfNeeded(this.DirTree(this.localFolder, this.dirTreeOptions)));
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

    addBasePathToEntries = (unfilteredTree, isBase = true) => {

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
                if (treeEntry.type === this.typeDirectory) {
                    // Recursive over the folders
                    unfilteredTree.children[childIndex] = this.addBasePathToEntries(treeEntry, false);
                }
            });
            // console.debug("addBasePathToEntries() unfilteredTree.children", unfilteredTree.children); // View the children in the response
        }

        return unfilteredTree;
    }


    filterOutRecursiveDirectoriesIfNeeded = (filteredTree) => {

        if (true === this.settings.recurseFolder && filteredTree && filteredTree.children && filteredTree.children.length > 0) {

            filteredTree.children = _.filter(filteredTree.children, treeEntry => {
                return treeEntry.type !== 'directory';
            });
        }

        // if (!Array.isArray(filteredTree)) {
        //     filteredTree = [filteredTree];
        // }
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
