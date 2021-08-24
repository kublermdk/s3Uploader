const QueueConsumerBase = require('../QueueConsumerBase.js');
const DeferredPromise = require('../DeferredPromise.js');

/**
 *
 */
class QueueConsumerTest extends QueueConsumerBase {

    processQueueTimeout = 1;

    processQueueEntry = (queueEntry) => {
        // A very basic example which waits a bit before returning

        let deferredPromise = new DeferredPromise();
        setTimeout(() => {
            queueEntry.processed = true;
            deferredPromise.resolve(queueEntry);
        }, this.processQueueTimeout || 1);
        return deferredPromise;
    }
}


module.exports = QueueConsumerTest;
