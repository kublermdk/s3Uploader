const _ = require('lodash');
const QueueAndConsumerBase = require('./ProcessorBase.js');

/**
 *
 * The queue class should:
 * Obviously contain a queue.
 * Contain the queue consumers
 *
 * The consumers should be able to grab the next entry from the queue when they've completed their processing.
 * If the queue is empty then adding to the queue should automatically send an entry to a waiting consumer
 * This means we need to be able to ask the consumer the state - Is it processing, idle or errored?
 *
 * You should be able to specify how many consumers are to be created
 * You should be able to specify the consumer factory class
 *
 * You should be able to send a signal to the script and
 * the consumers will complete what processing they are doing
 * but not get any more entries from the queue
 *
 * Graceful Exit - One signal will mean they complete processing then exit
 * Pause - Another signal means they will complete processing then wait
 * Play - With a 3rd signal meaning they will continue processing
 *
 * You should also be able to provide custom hook functions to do more complex stuff.
 * A custom.js (or local.js?) file is checked and imported.
 * All methods are run as async / await to allow for complex calls
 *
 * onInit - On startup
 * beforeProcessing - Before any scan processing. It's given the configuration options and can manipulated them, like add complex regex to the exclude
 * beforeFileProcessing - Before a specific file is processed. It's given a file entry and the general config info and you can change the file entry or do custom actions
 * afterFileProcessing - After a file has been uploaded
 * afterProcessing - After all processing for a scan / round is complete
 * onEnd - On a clean shutdown
 *
 *
 * Note that there's a watcher or if not available a polling system that checks to see if there's any newly modified files for being uploaded and adds them to the queue.
 * The file processing will check to see if the file exists on S3 and has the same size and SHA512 hash.
 */
class ProcessingQueue extends QueueAndConsumerBase {
    queue = []; //
    consumers = [];


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


    options = {
        consumerCount: 2,
        consumerClass: null, // Required
        consumerInfo: {},
    }

    constructor(options = {}, settings = {}) {
        super(settings);
        this.options = _.merge(this.options, options);

        if (null === this.options.consumerClass) {
            this.setStatus(this.statuses.errored);
            throw new Error("Expecting a valid consumer class, none provided");
        }

        // -- Create the Consumers
        _.each(_.range(0, this.options.consumerCount), index => {
            this.addConsumer();
        });
    };

    /**
     * Start the consumers actually doing the processing
     */
    start() {
        this.setStatus(this.statuses.starting);
        _.each(this.consumers, consumer => {
            consumer.start();
        });
        this.setStatus(this.statuses.started);
        this.started = true;
        return this.getConsumerCount();
    }

    /**
     * The way to add new entries
     * @param queueEntry
     */
    addToQueue(queueEntry) {
        this.queue.push(queueEntry);

        if (this.started) {
            let consumer = this.findWaitingConsumer();
            if (consumer) {
                consumer.run();
            }
        }
    }

    async drained() {
        let interval = null;

        return new Promise((resolve, reject) => {

            // Initial run
            if (this.isDrained()) {
                resolve(true);
            }

            // Keep checking
            interval = setInterval(() => {
                if (this.isDrained()) {
                    resolve(true);
                }
            }, 200);

        });
    }

    isDrained() {
        return this.queue.length === 0 && !this.findBusyConsumer();
    }

    findBusyConsumer() {
        return _.find(this.consumers, consumer => {
            return consumer.isActive && consumer.started;
        });
    }

    findWaitingConsumer() {
        return _.find(this.consumers, consumer => {
            return !consumer.isActive && consumer.started;
        });
    }

    addConsumer() {
        this.consumers.push(new this.options.consumerClass(this, this.options.consumerInfo, this.settings));
        this.addActivity(`Added another consumer ${this.options.consumerCount}`);
    }

    /**
     * Used by the Queue Consumers
     *
     * @returns {*}
     */
    getQueueEntry() {
        if (this.queue.length === 0) {
            return null;
        }
        return this.queue.pop();
    }


    getStatistics(verbose = false) {

        let stats = {
            status: this.getStatus(),
            queueCount: this.getQueueCount(),
            consumerCount: this.getConsumerCount(),
        }
        if (verbose) {
            stats.activity = this.getActivity();
        }
        return stats;
    }

    getQueueCount() {
        return this.queue.length;
    }

    getConsumerCount() {
        return this.consumers.length;
    }

    /**
     * This should really not be used much
     * @returns {[]}
     */
    getQueue() {
        return this.queue;
    }


}


module.exports = ProcessingQueue;
