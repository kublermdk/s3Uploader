const _ = require('lodash');
const QueueAndConsumerBase = require('./ProcessorBase.js');

/**
 *
 * The queue processor class should:
 */
class QueueConsumerBase extends QueueAndConsumerBase {
    status = 'init';
    processingQueue;
    info = {}; // Custom Environment info provided when the queue was created

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

    constructor(processingQueue, consumerInfo = {}, settings = {}) {
        super(settings);
        this.processingQueue = processingQueue;
        this.info = consumerInfo;

        this.setStatus(this.statuses.starting);
    };


    run = async () => {
        this.processingQueue.get
    }

    processQueueEntry = async (entry) => {
        // A very basic example which waits 1s then returns
        setTimeout(1000, () => {
            return entry;
        }, 1000);
    }
}


module.exports = QueueConsumerBase;
