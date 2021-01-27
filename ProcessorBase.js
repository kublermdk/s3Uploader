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
    isActive = false; // If true it's actively processing a queue entry. If false it can be farmed out
    errors = []; // A log of any errors

    settings = {
        ident: Math.random() * 1000, // Probably best replaced with the array index number
        activityLength: 100
    };
    startedAt;


    constructor(settings) {
        this.settings = _.merge(this.settings, settings); // Add in any custom configuration settings
    }

    setStatus(status) {
        this.addActivity(`Setting the status from '${this.status}' to '${status}'`);
        this.status = status;

        if (this.activity.length > this.settings.activityLength + 5) {
            this.activity = this.activity.slice(0, this.settings.activityLength);
        }

        if (status === this.statuses.started) {
            this.started = true;
            this.startedAt = new Date();
        }
    }

    addError(error) {
        this.errors.push(error);
        this.setStatus(this.statuses.errored);
        console.error("An error occurred: ", error);
    }

    addActivity(activityMessage) {
        this.activity.push({message: activityMessage, date: new Date()});
    }


    statuses = {
        'init': 'init', // Initialising
        'starting': 'starting', // Creating the consumers and will start consuming the queue if there's any entries
        'started': 'started', // The consumers have been created but aren't yet processing anything
        'processing': 'processing', // The main state, it's actually working
        'processed': 'processed', // Just finished processing, will now check if there's another item or if it'll be idle
        'idle': 'idle', // When there's nothing to process (queue is empty)
        'pausing': 'pausing', // Stopping the consumers, they won't grab any new queue items
        'paused': 'paused', // All consumers have stopped
        'playing': 'playing', // Similar to starting, but re-enabling the processing after being in a paused state, should quickly transition to processing
        'stopping': 'stopping', // As it says, stopping the queue, finishing the consumers, not allowing any new queue entries and running end of processing hooks
        'stopped': 'stopped', // No more queue or processing. Can't be resumed. Usually there's an exit of the app on this state
        'errored': 'errored', // Errored obviously means something bad happened, it's likely the whole script should stop
    }

    getStatus() {
        return this.status;
    }

    getActivity() {
        let activities = [];
        _.each(this.activity, activityEntry => {
            // console.log(activity);
            // e.g { message: "Setting the status from 'init' to 'starting'", date: 2021-01-27T19:19:54.496Z }
            activities.push(activityEntry.date.toISOString() + ' ' + activityEntry.message);
        });
        return activities && activities.join(`\n`);
    }

}


module.exports = QueueAndConsumerBase;
