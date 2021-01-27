const ProcessingQueue = require('../ProcessingQueue.js');
const QueueConsumer = require('../QueueConsumer.js');
const QueueConsumerBase = require('../QueueConsumerBase.js');

let processingQueueSettingsDefault = {consumerCount: 2, consumerClass: QueueConsumerBase};

// You'll likely want to  `npm install jest --global`
// Check https://jestjs.io/docs/en/getting-started.html for more information on using Jest tests

test('Processing Queue is created', () => {

    let processingQueue = new ProcessingQueue(processingQueueSettingsDefault);
    expect(processingQueue).toBeDefined();
    expect(processingQueue.getConsumerCount()).toBe(0);
    expect(processingQueue.getStatistics()).toEqual({
        "consumerCount": 0,
        "queueCount": 0,
        "status": "init",
    });

    // Start
    processingQueue.start();
    expect(processingQueue.getConsumerCount()).toBe(2);
    expect(processingQueue.getStatistics()).toEqual({
        "consumerCount": 2,
        "queueCount": 0,
        "status": "starting",
    });

});


test('Processing Queue can have different settings', () => {

    let processingQueueSettingsOne = {consumerCount: 1, consumerClass: QueueConsumerBase};
    let processingQueue = new ProcessingQueue(processingQueueSettingsOne);
    // Start
    processingQueue.start();
    expect(processingQueue.getConsumerCount()).toBe(1);
    expect(processingQueue.getStatistics()).toEqual({
        "consumerCount": 1,
        "queueCount": 0,
        "status": "starting",
    });

});


test('Processing Queue is created', () => {

    let processingQueue = new ProcessingQueue(processingQueueSettingsDefault);
    expect(processingQueue.getQueueCount()).toBe(0);
    processingQueue.addToQueue({name: "test"});
    expect(processingQueue.getQueueCount()).toBe(1);

    // Start
    processingQueue.start();
    expect(processingQueue.getStatistics()).toEqual({
        "consumerCount": 2,
        "queueCount": 1,
        "status": "starting",
    });


});


test('Processing Queue errors about no Queue Consumer', () => {
    expect(() => {
        new ProcessingQueue();
    }).toThrow("Expecting a valid consumer class, none provided");
});
