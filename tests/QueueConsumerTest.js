const QueueConsumerBase = require('../QueueConsumerBase.js');

/**
 *
 */
class QueueConsumerTest extends QueueConsumerBase {

    processQueueTimeout = 1;

    processQueueEntry = async (queueEntry) => {
        // A very basic example which waits a bit before returning
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                queueEntry.processed = true;
                resolve(queueEntry);
            }, this.processQueueTimeout);
        });
    }
}


module.exports = QueueConsumerTest;
