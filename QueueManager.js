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
 *
 *
 * Some Async queue references (that I read after implimenting this):
 * https://glot.io/snippets/ete2axnjzo
 * https://krasimirtsonev.com/blog/article/implementing-an-async-queue-in-23-lines-of-code
 *
 * Maybe I should've just used https://caolan.github.io/async/v3/index.html
 */
class QueueManager extends QueueAndConsumerBase {
    queue = []; //
    consumers = [];
    consumersCreated = 0; // Used for idents even if you add/remove consumers


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
            this.addConsumer(index);
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

    /**
     * Let us know when the queue is fully drained
     * Note that this isn't perfectly in tune with responses from the consumers, it's a very basic polling, but works well enough (within 200ms)
     *
     * @returns {Promise<unknown>}
     */
    drained() {
        let interval = null;

        return new Promise((resolve, reject) => {

            // -- Initial run
            if (this.isDrained() === true) {
                resolve(true);
            }


            // -- Keep checking
            interval = setInterval(() => {
                if (this.isDrained() === true) {
                    clearInterval(interval);
                    resolve(true);
                }
            }, 200);

        });
    }

    isDrained() {
        if (!this.started) {
            return false;
        }
        return this.queue.length === 0 && this.findBusyConsumer() === undefined;
    }

    findBusyConsumer() {
        return _.find(this.consumers, consumer => {
            return consumer.isActive === true && consumer.started === true;
        });
    }

    findWaitingConsumer() {
        return _.find(this.consumers, consumer => {
            return consumer.isActive === false && consumer.started === true;
        });
    }

    findWaitingConsumerIndex() {
        return _.findIndex(this.consumers, consumer => {
            return consumer.isActive === false && consumer.started === true && [this.statuses.paused, this.statuses.idle].includes(consumer.status);
        });
    }

    addConsumer() {

        this.consumersCreated++;
        let ident = 'consumer-' + this.consumersCreated;
        this.consumers.push(new this.options.consumerClass(
            this,
            this.options.consumerInfo,
            _.merge({}, this.settings, {ident: ident})));
        this.addActivity(`Added consumer ${ident} of ${this.options.consumerCount}`);
    }

    /**
     * Will return a promise which is resolved once a consumer is removed
     * Note: You shouldn't try removing too many consumers at once as it'll likely cause a race condition
     * @returns {Promise<unknown>}
     */
    removeConsumer() {
        return new Promise((resolve, reject) => {
            if (this.consumers.length === 0) {
                resolve(false);
            }

            let interval = setInterval(() => {
                // We check again here because if you've tried removing multiple consumers at once we don't want to keep multiple removals pending until you've added them only to find them unexpectedly disappear again
                if (this.consumers.length === 0) {
                    resolve(false);
                }
                let consumerIndex = this.findWaitingConsumerIndex();
                if (consumerIndex !== undefined) {
                    this.consumers[consumerIndex].pause();
                    this.consumers = this.consumers.splice(consumerIndex, 1); // Remove the consumer
                    clearInterval(interval)
                    resolve(consumerIndex);
                }
            }, 100);

        });
    }

    pauseConsumers() {
        _.each(this.consumers, consumer => {
            consumer.pause();
        })
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
        return this.queue.shift();
    }

    /**
     * It's expected you'll use this for a web response or something similar
     *
     * @param verbose
     * @returns {{queueCount: number, consumerCount: number, status: string}}
     */
    getStatistics(verbose = false) {

        let stats = {
            status: this.getStatus(),
            queueCount: this.getQueueCount(),
            consumerCount: this.getConsumerCount(),
        }
        if (verbose) {
            stats.activity = this.getActivity();
            stats.consumers = [];
            _.each(this.consumers, consumer => {
                    stats.consumers.push(consumer.getStatistics(true));
                }
            )
        }
        return stats;
    }

    updateConsumerInfo(consumerInfo) {
        _.each(this.consumers, consumer => {
            consumer.info = consumerInfo;
        });
        return consumerInfo;
    }

    getQueueCount() {
        return this.queue.length;
    }

    getConsumerCount() {
        return this.consumers.length;
    }

    /**
     * Maybe you need this if you are wanting to know the contents of the queue?
     * @returns {[]}
     */
    getQueue() {
        return this.queue;
    }


}


module.exports = QueueManager;
