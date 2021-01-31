const _ = require('lodash');
const QueueAndConsumerBase = require('./QueueAndConsumerBase.js');

/**
 *
 * The queue processor class should:
 */
class QueueConsumerBase extends QueueAndConsumerBase {
    status = 'init';
    queueManager;
    processingStarted;
    processingPaused = false; // If true it doesn't take any new entries
    info = {}; // Custom Environment info provided when the queue was created
    queueEntriesProcessed = 0;

    // statuses = {
    //     'init': 'init', // Initialising
    //     'starting': 'starting', // Creating the consumers and will start consuming the queue if there's any entries
    //     'processing': 'processing', // The main state, it's actually working
    //     'pausing': 'pausing', // Stopping the consumers, they won't grab any new queue items
    //     'paused': 'paused', // All consumers have stopped
    //     'playing': 'playing', // Similar to starting, but re-enabling the processing after being in a paused state, should quickly transition to processing
    //     'stopping': 'stopping', // As it says, stopping the queue, finishing the consumers, not allowing any new queue entries and running end of processing hooks
    //     'stopped': 'stopped', // No more queue or processing. Can't be resumed. Usually there's an exit of the app on this state
    //     'errored': 'errored', // Errored obviously means something bad happened, it's likely the whole script should stop
    // }

    constructor(queueManager, consumerInfo = {}, settings = {}) {
        super(settings);
        this.queueManager = queueManager;
        this.info = consumerInfo;
        this.setStatus(this.statuses.starting);
    };

    start = async () => {
        if ([this.statuses.init, this.statuses.starting].includes(this.status)) {
            this.setStatus(this.statuses.started);
        }
        return await this.run();
    }

    /**
     * NB: This doesn't wait until the processing is completed to return, it can take a while before it actually pauses
     * as it will only pause fully when it goes to run
     *
     * @todo: Deal with stopped / stopping
     */
    pause() {
        this.processingPaused = true;
        if (this.started === true) {
            return;
        }

        if (this.isActive === true) {
            // It is currently processing
            this.setStatus(this.statuses.pausing);
        } else {
            // It's idle (or maybe errored)
            this.setStatus(this.statuses.paused);
        }
    }

    /**
     * @todo: Deal with stopped / stopping
     * @returns {Promise<unknown>|string}
     */
    play() {
        this.processingPaused = false;
        if (this.started === false) {
            // Haven't started yet
            return;
        }

        if (this.isActive === true) {
            // It is already processing
            if (this.status === this.statuses.pausing) {
                this.setStatus(this.statuses.processing);
            }
        } else {
            // Not currently processing, so start it
            this.setStatus(this.statuses.playing);
            return this.run(); // Should we return this?
        }
        return this.status;
    }

    getStatistics(verbose = false) {
        let stats = {
            status: this.getStatus(),
            isActive: this.isActive,
            started: this.started,
            queueEntriesProcessed: this.queueEntriesProcessed,
            errors: this.errors,
        }
        if (verbose) {
            stats.startedAt = this.startedAt;
            stats.activity = this.getActivity();
        }
        return stats;
    }

    run = async () => {

        if (this.processingPaused === true) {
            this.setStatus(this.statuses.paused);
            return null;
        }
        this.isActive = true;
        let queueEntry = this.queueManager.getQueueEntry();
        if (null === queueEntry) {
            this.setStatus(this.statuses.idle);
            this.addActivity("No more queue entries, will wait for more");
            this.isActive = false;
            return null;
        }

        this.setStatus(this.statuses.processing);
        this.processingStarted = new Date();
        // console.log("Processing queueEntry", queueEntry);

        // Pre-Process
        queueEntry = await this.preProcessEntry(queueEntry).catch(err => {
            this.addError(err);
        });

        // ----------------------------
        //   The main process!
        // ----------------------------

        let processedQueueResponse = await this.processQueueEntry(queueEntry).catch(err => {
            this.addError(err);
        }); // Run the actual main part

        queueEntry = await this.postProcessEntry(queueEntry, processedQueueResponse).catch(err => {
            this.addError(err);
        });


        this.setStatus(this.statuses.processed);
        this.queueEntriesProcessed++;
        this.addActivity(`Processed queueEntry #${this.queueEntriesProcessed} in ` + (new Date().getTime() - this.processingStarted.getTime()) + ' ms');

        // -- Resolve the queue task promise
        if (queueEntry['__completedQueueTaskPromise']) {
            queueEntry['__completedQueueTaskPromise'].resolve(processedQueueResponse);
        }

        // -- Run it again and check if there's another entry
        setTimeout(() => {
            this.run();
        }, 1);
        return processedQueueResponse;
    }


    /**
     * This is mostly for you to replace in your own class
     * Especially useful for changing the queueEntry if needed
     *
     * It's expected the queueEntry or something like it will be returned that's then used by the main processQueueEntry
     * Note that this is triggered even if the setting to not process the queue (.env is ACTUALLY_UPLOAD) is false
     *
     * So you can set ACTUALLY_UPLOAD=false but put your own processing stuff here.
     * Or a better option would be to replace the processQueueEntry method of the class before providing it to the queue manager
     * @param queueEntry
     * @returns {Promise<*>}
     */
    preProcessEntry = async (queueEntry) => {
        return queueEntry;
    }

    processQueueEntry = async (queueEntry) => {
        // A very basic example which waits a bit before returning
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                queueEntry.processed = true;
                resolve(queueEntry);
            }, 500);
        });
    }

    /**
     * Run after the queue entry has been processed
     * In the S3 uploader this is the method where the file is deleted if DELETE_ON_UPLOAD=true
     *
     * This is provided both the original queueEntry and the processQueueResponse (the response from the processQueueEntry)
     * @param queueEntry
     * @param processQueueResponse
     * @returns {Promise<void>}
     */
    postProcessEntry = async (queueEntry, processQueueResponse) => {
        return queueEntry;
    }
}


module.exports = QueueConsumerBase;
