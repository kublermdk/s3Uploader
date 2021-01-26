const _ = require('lodash');

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
class ProcessingQueue {
    queue = []; //
    consumers = [];
    status = 'init'; // Valid statuses include:

    statuses = {
        'init': 'init', // Initialising
        'starting': 'starting', // Creating the consumers and will start consuming the queue if there's any entries
        'processing': 'processing', // The main state, it's actually working
        'pausing': 'pausing', // Stopping the consumers, they won't grab any new queue items
        'paused': 'paused', // All consumers have stopped
        'playing': 'playing', // Similar to starting, but re-enabling the processing after being in a paused state, should quickly transition to processing
        'stopping': 'stopping', // As it says, stopping the queue, finishing the consumers, not allowing any new queue entries and running end of processing hooks
        'stopped': 'stopped', // No more queue or processing. Can't be resumed. Usually there's an exit of the app on this state
        'errored': 'errored', // Errored obviously means something bad happened, it's likely the whole script should stop

    }

    activity = []; // An array of status entries and any other details

    options = {
        consumerCount: 2,
        consumerClass: null, // Required
    }

    constructor(options = {}) {
        this.options = _.merge(this.options, options);

        if (null === this.options.consumerClass) {
            this.setStatus(this.statuses.errored);
            throw new Error("Expecting a valid consumer class, none provided");
        }
    };

    setStatus(status) {
        this.activity.push({message: `Setting the status from '${this.status}' to '${status}'`});
        this.status = status;
    }

    addActivity(activityMessage) {
        this.activity.push({message: activityMessage});
    }

    start() {
        this.setStatus(this.statuses.starting);

        // -- Create the Consumers
        _.each(_.range(0, this.options.consumerCount), index => {

            this.consumers.push(new this.options.consumerClass);
            this.addActivity(`Added consumer #${index} of ${this.options.consumerCount}`);
        });

    }

    /**
     * The way to add new entries
     * @param queueEntry
     */
    addToQueue(queueEntry) {
        this.queue.push(queueEntry);

        // @todo: Message the consumers, depending on the state
        if (this.status === this.statuses.processing) {

        }
    }

    getStatus() {
        return this.status;
    }

    getActivity() {
        return this.activity;
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
