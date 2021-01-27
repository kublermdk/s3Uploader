const ProcessingQueue = require('../ProcessingQueue.js');
const QueueConsumer = require('../QueueConsumer.js');
const QueueConsumerBase = require('../QueueConsumerBase.js');

let processingQueueSettingsDefault = {consumerCount: 2, consumerClass: QueueConsumerBase};
let processingQueueSettingsOne = {consumerCount: 1, consumerClass: QueueConsumerBase};

// You'll likely want to  `npm install jest --global`
// Check https://jestjs.io/docs/en/getting-started.html for more information on using Jest tests


describe('Processing Queue', () => {

    test('is created', () => {

        let processingQueue = new ProcessingQueue(processingQueueSettingsDefault);
        expect(processingQueue).toBeDefined();
        expect(processingQueue.getConsumerCount()).toBe(2);
        expect(processingQueue.getStatistics()).toEqual({
            "consumerCount": 2,
            "queueCount": 0,
            "status": "init",
        });
    });


    test('can have a different consumerCount', () => {

        let processingQueueSettingsOne = {consumerCount: 1, consumerClass: QueueConsumerBase};
        let processingQueue = new ProcessingQueue(processingQueueSettingsOne);
        expect(processingQueue.getConsumerCount()).toBe(1);
        expect(processingQueue.getStatistics()).toEqual({
            "consumerCount": 1,
            "queueCount": 0,
            "status": "init",
        });

    });


    test('is created', () => {

        let processingQueue = new ProcessingQueue(processingQueueSettingsDefault);
        expect(processingQueue.getQueueCount()).toBe(0);
        processingQueue.addToQueue({name: "test"});
        expect(processingQueue.getQueueCount()).toBe(1);
        expect(processingQueue.getStatistics()).toEqual({
            "consumerCount": 2,
            "queueCount": 1,
            "status": "init",
        });

    });


    test('errors about no Queue Consumer', () => {
        expect(() => {
            new ProcessingQueue();
        }).toThrow("Expecting a valid consumer class, none provided");
    });


    test('accepts an extended Queue Consumer', () => {
        // We use QueueConsumer not QueueConsumerBase
        let processingQueue = new ProcessingQueue({consumerCount: 1, consumerClass: QueueConsumer});
        expect(processingQueue.getStatistics()).toEqual({
            "consumerCount": 1,
            "queueCount": 0,
            "status": "init",
        });
        expect(processingQueue.consumers[0]).toBeInstanceOf(QueueConsumer);
    });


    test('settings default', () => {
        let processingQueue = new ProcessingQueue(processingQueueSettingsDefault);
        expect(processingQueue.settings).toEqual({
            "activityLength": 100,
        });
        expect(processingQueue.consumers[0].settings).toEqual({
            "activityLength": 100,
        });

    });


    test('settings flow through', () => {
        let processingQueue = new ProcessingQueue(processingQueueSettingsOne, {"activityLength": 1});
        expect(processingQueue.settings).toEqual({
            "activityLength": 1,
        });
        expect(processingQueue.consumers[0].settings).toEqual({
            "activityLength": 1,
        });

    });


    test('runs on start', async () => {
        // let processingQueue = new ProcessingQueue(processingQueueSettingsDefault);
        let processingQueue = new ProcessingQueue(processingQueueSettingsOne);
        processingQueue.addToQueue({name: "test 1"});
        processingQueue.addToQueue({name: "test 2"});
        processingQueue.addToQueue({name: "test 3"});
        processingQueue.start();
        // expect(processingQueue.getStatistics()).toEqual({
        //     "consumerCount": 2,
        //     "queueCount": 0,
        //     "status": "started",
        // });

        await processingQueue.drained().then(hasDrained => {
            expect(hasDrained).toBeTruthy();
            expect(hasDrained).toEqual(true);
            console.log("Drained");
        });


    });

});

