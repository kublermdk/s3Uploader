const _ = require('lodash');


/**
 * A base class for both the Processing Queue and Queue Consumer
 *
 * This mostly contains the status and activity details
 */
class QueueAndConsumerBase {
    status = 'init';
    activity = []; // An array of information about what the consumer has been doing.
    started = false; // When true it has begun wanting to be processing
    isProcessing = false; // If true it's actively processing a queue entry. If false it can look for a new one or be removed safely
    errors = []; // A log of any errors

    /**
     * Settings are more intrinsic settings that aren't expected to change whilst the service is running
     * e.g the identity of the consumer or manager or the maximum length of the activity listing
     *
     * Where as the consumer config is more for configuration options of the consumer (e.g S3 bucket name and folder)
     *
     * @type {{ident, activityLength: number}}
     */
    settings = {
        ident: Math.random() * 1000, // Probably best replaced with the array index number
        activityLength: 5000
    };
    startedAt;

    statuses = {
        'init': 'init', // Initialising
        'starting': 'starting', // Creating the consumers and will start consuming the queue if there's any entries
        'started': 'started', // The consumers have been created but aren't yet processing anything
        'preprocessing': 'preprocessing', // The main state, it's actually working
        'processing': 'processing', // The main state, it's actually working
        'postprocessing': 'postprocessing', // The main state, it's actually working
        'processed': 'processed', // Just finished processing, will now check if there's another item or if it'll be idle
        'idle': 'idle', // When there's nothing to process (queue is empty)
        'pausing': 'pausing', // Stopping the consumers, they won't grab any new queue items
        'paused': 'paused', // All consumers have stopped
        'playing': 'playing', // Similar to starting, but re-enabling the processing after being in a paused state, should quickly transition to processing
        'stopping': 'stopping', // As it says, stopping the queue, finishing the consumers, not allowing any new queue entries and running end of processing hooks
        'stopped': 'stopped', // No more queue or processing. Can't be resumed. Usually there's an exit of the app on this state
        'errored': 'errored', // Errored obviously means something bad happened, it's likely the whole script should stop
    }


    constructor(settings) {
        this.settings = _.merge(this.settings, settings); // Add in any custom configuration settings
    }

    setStatus(status) {
        this.addActivity(`Setting the status from '${this.status}' to '${status}'`);
        this.status = status;

        if (status === this.statuses.started) {
            this.started = true;
            this.startedAt = new Date();
        }
    }

    /**
     * Add Error
     *
     * Example usage:
     * if (err) {
     *     this.addError(err, 'S3 Upload Error');
     *     reject(err);
     * }
     * @param error Error
     * @param contextMessage String
     */
    addError(error, contextMessage = '') {
        if ('' === contextMessage) {
            contextMessage = `Status: ${this.status}, Ident: ${this.settings.ident}`;
        }
        this.errors.push({error, contextMessage});
        this.addActivity(`Error! ${contextMessage}`, error);

        if (true === _.get(this.settings, 'OUTPUT_ERRORS', true)) {
            console.error(`An error occurred: ${contextMessage}: `, error);
        }
        this.setStatus(this.statuses.errored);
    }

    addActivity(message, data = null) {
        if (0 === this.settings.activityLength) {
            // Don't add anything
            return 0;
        }
        this.activity.push({message, data, date: new Date()});
        if (this.settings.activityLength > 0 && this.activity.length > this.settings.activityLength) {
            this.activity.shift(); // Remove an item from the start of the array
            // @todo: Workout if we need to remove multiple entries from the array. e.g this.activity.slice(this.settings.activityLength, this.settings.activityLength - this.activity.length);
        }
        if (true === _.get(this.settings, 'OUTPUT_ACTIVITY_LOGS', false)) {
            console.log(message, data);
        }
        return this.activity.length;
    }


    getStatus() {
        return this.status;
    }

    getActivity() {
        let activities = [];
        _.each(this.activity, activityEntry => {
            // console.log(activity);
            // e.g { message: "Setting the status from 'init' to 'starting'", date: 2021-01-27T19:19:54.496Z }
            activities.push(activityEntry.date.toISOString() + ' ' + activityEntry.message + (activityEntry.data === null ? '' : ': ' + JSON.stringify(activityEntry.data)));
        });
        return activities; // && activities.join(`\n`);
    }

}


module.exports = QueueAndConsumerBase;
