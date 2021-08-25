const QueueConsumerBase = require('./QueueConsumerBase.js');
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const DeferredPromise = require('./DeferredPromise.js');
const _ = require('lodash');
// const sha256File = require('sha256-file');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

/**
 * Queue Consumer GT Local
 *
 * For processing video (and photo) files with the Gather Together CLI
 */
class QueueConsumerGTLocal extends QueueConsumerBase {

    /**
     * You need to specify the constructor in the extended Queue Consumer
     * and do your own merge if you want to have the defaultConfig get applied as intended
     * @param queueManager
     * @param consumerConfig
     * @param settings
     */
    constructor(queueManager, consumerConfig = {}, settings = {}) {
        super(queueManager, consumerConfig, settings);
        this.config = _.merge(this.config, this.defaultConfig, consumerConfig);
    }

    // The default configuration is added to the config in the constructor
    defaultConfig = {
        FILEPATH_CLI_ARG: '--file=', // Added before the filename, you could have it with a space without anything, whatever is needed. e.g '/usr/kublermdk/gt/script/cli.js --filepath="/usr/kublermdk/gt/2. Queue/2021-08-23rd-video of some cool stuff.mp4"'
        // scriptPath: e.g "/usr/home/kublermdk/gt/bin/cli" Expecting this to be in the config and to point to what we want to trigger
        child_process_options: {
            encoding: 'utf8',
            timeout: 0, // No timeout if 0 otherwise then in milliseconds
            // maxBuffer: 2000 * 1024, // Allow lots of console.log output if needed
            killSignal: 'SIGTERM',
            // cwd: null, // @todo: Possible needs to be set to the working directory of the GT script or the Queue folder?
            // env: null // setting it means it probably doesn't send the usual process.env
        }
    }

    processQueueEntry = async (treeEntry) => {

        /*
        Example treeEntry is:
        {
          "path": "/usr/kublermdk/gt/2. Queue/2021-08-23rd-video of some cool stuff.mp4",
          "name": "2021-08-23rd-video of some cool stuff.mp4",
          "size": 1312736761, // (1,312,736,761 = 1.22 GB)
          "extension": ".mp4",
          "type": "file",
          "mode": 33206,
          "mtime": "2021-08-23T02:47:30.290Z",
          "mtimeMs": 1610160450289.9504,
          "basePath": "/usr/kublermdk/gt/2. Queue/2021-08-23rd-video of some cool stuff.mp4", // added in from the dirTree root entry, not there by default in dirTree for a child entry
          "__completedQueueTaskPromise": {
            "_promise": {}
          }
        }
         */
        return new Promise((resolve, reject) => {
                let processingTimeStarted = new Date();
                let cliOptions = this.config.child_process_options;
                // const basePath = treeEntry.basePath;
                // let localFilePath = path.join(treeEntry.path); // Convert to a local filepath that fs can read
                let localFilePath = treeEntry.path;

                let processingExecCommand = `${this.config.scriptPath} ${this.config.FILEPATH_CLI_ARG}"${localFilePath}"`
                console.log("About to run with: ", processingExecCommand, 'and the cli options: ', cliOptions);

                let processingStartTime = new Date();

                // -------------------------------------------------------------------------
                //   Actually Start the Processing!!
                // -------------------------------------------------------------------------
                exec(processingExecCommand, cliOptions).then(results => {
                    const {stdout, stderr} = results; // Results contains stdout and stderr arrays
                    let fileProcessingTimeMs = new Date().getTime() - processingStartTime.getTime(); // in ms
                    let processingTime = (new Date().getTime() - processingTimeStarted.getTime()) / 1000 + 's';
                    this.addActivity("Processed file locally with Gather Together: " + JSON.stringify({
                        localFilePath,
                        fileProcessingTimeMs, // in ms
                        processingTime,
                        results,
                    }));
                    resolve({
                        processed: true,
                        localFilePath,
                        fileProcessingTimeMs,
                        processingTime,
                        treeEntry,
                        stdout,
                        stderr
                    });
                }).catch(err => {
                    this.addError(err, `Error trying to process file: "${treeEntry.path}"\n`);
                    // console.error("Error whilst processing: ", treeEntry, "\nError: ", err);
                    resolve({processed: false, err});
                    // reject(err);
                });
            }
        );
    }

    /**
     * Should return the queueEntry
     *
     * @param queueEntry
     * @param processQueueResponse
     * @param error
     * @returns {Promise<boolean|*>}
     */
    postProcessEntry = (queueEntry, processQueueResponse, error) => {
        return new Promise((resolve, reject) => {

            if (!_.isEmpty(error)) {
                // There was a pre or main processing error
                // You likely don't want to do anything important like deleting files if that's the case
                this.addActivity('As there was an error in previous processing, not postProcessing the ' + this.identQueueEntry(queueEntry));
                // console.warn('As there was an error, not postProcessing the ' + this.identQueueEntry(queueEntry));
                queueEntry.postProcessingCompleted = false;
                resolve(queueEntry);
            }

            let localFilePath = _.get(processQueueResponse, 'localFilePath', path.join(queueEntry.path)); // Convert to a local filepath that fs can read
            // if (true === _.get(this.config, 'DELETE_ON_PROCESSED', false)) {
            //     console.log('Going to delete the file ' + this.identQueueEntry(queueEntry));
            //     fs.promises.unlink(localFilePath).then(() => {
            //         queueEntry.deleted = true;
            //         queueEntry.postProcessingCompleted = true;
            //         this.addActivity('Deleted the file ' + this.identQueueEntry(queueEntry));
            //         // console.warn('Deleted the file ' + this.identQueueEntry(queueEntry));
            //         resolve(queueEntry);
            //     }).catch((err) => {
            //         this.addError(err, 'Issue when trying to post process delete the file ' + this.identQueueEntry(queueEntry));
            //         queueEntry.deleted = false;
            //         queueEntry.postProcessingCompleted = false;
            //         // return queueEntry;
            //         reject(err);
            //     });
            //
            // } else {
                queueEntry.postProcessingCompleted = true;
                resolve(queueEntry);
            // }

        });
    }

    identQueueEntry(queueEntry) {
        if (_.isEmpty(queueEntry)) {
            return 'Empty Queue Entry';
        }

        let queueEntryIdent = 'Queue Entry ';
        if (_.get(queueEntry, 'path')) {
            return queueEntryIdent + _.get(queueEntry, 'path');
        }

    }
}


module.exports = QueueConsumerGTLocal;