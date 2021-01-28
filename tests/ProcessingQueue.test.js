const ProcessingQueue = require('../ProcessingQueue.js');
const QueueConsumer = require('../QueueConsumer.js');
const QueueConsumerBase = require('../QueueConsumerBase.js');
const dirTree = require("directory-tree");
const path = require('path');


// You'll likely want to  `npm install jest --global`
// Check https://jestjs.io/docs/en/getting-started.html for more information on using Jest tests

QueueConsumerBase.processQueueEntry = async (entry) => {
    // A very basic example which waits a bit before returning
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            entry.processed = true;
            resolve(entry);
            // Making it a 1ms not 500ms timeout for faster checking
        }, 1);
    });
};

let processingQueueSettingsDefault = {consumerCount: 2, consumerClass: QueueConsumerBase};
let processingQueueSettingsOne = {consumerCount: 1, consumerClass: QueueConsumerBase};


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
            "ident": expect.any(Number),
        });
        expect(processingQueue.consumers[0].settings).toEqual({
            "activityLength": 100,
            "ident": expect.any(String),
        });

    });


    test('settings flow through', () => {
        let processingQueue = new ProcessingQueue(processingQueueSettingsOne, {"activityLength": 1});
        expect(processingQueue.settings).toEqual({
            "activityLength": 1,
            "ident": expect.any(Number),
        });
        expect(processingQueue.consumers[0].settings).toEqual({
            "activityLength": 1,
            "ident": expect.any(String),
        });

    });


    test('runs on start', async () => {
        let processingQueue = new ProcessingQueue(processingQueueSettingsDefault);
        // let processingQueue = new ProcessingQueue(processingQueueSettingsOne);
        processingQueue.addToQueue({name: "test 1"});
        processingQueue.addToQueue({name: "test 2"});
        processingQueue.addToQueue({name: "test 3"});
        processingQueue.addToQueue({name: "test 4"});
        processingQueue.addToQueue({name: "test 5"});

        let dateStarted = new Date();
        processingQueue.start();
        expect.assertions(3);
        expect(processingQueue.getStatistics()).toEqual({
            "consumerCount": expect.any(Number),
            "queueCount": expect.any(Number),
            "status": "started",
        });

        let hasDrained = await processingQueue.drained();
        expect(hasDrained).toBeTruthy();
        expect(hasDrained).toEqual(true);
        console.log("Drained in ", new Date().getTime() - dateStarted.getTime() + ' ms');
        // console.log("Stats: ", processingQueue.getStatistics());
        // console.log("Consumers: ", processingQueue.getStatistics(true).consumers);

    });


    test('runs if queue is added after start', async () => {
        let processingQueue = new ProcessingQueue(processingQueueSettingsDefault);
        // let processingQueue = new ProcessingQueue(processingQueueSettingsOne);
        let dateStarted = new Date();
        processingQueue.start();
        processingQueue.addToQueue({name: "test 1"});
        processingQueue.addToQueue({name: "test 2"});
        processingQueue.addToQueue({name: "test 3"});

        expect(processingQueue.getStatistics()).toEqual({
            "consumerCount": expect.any(Number),
            "queueCount": expect.any(Number),
            "status": "started",
        });

        let hasDrained = await processingQueue.drained();
        expect(hasDrained).toEqual(true);
        // console.log("Drained in ", new Date().getTime() - dateStarted.getTime() + ' ms');
        processingQueue.addToQueue({name: "test 3"});
        await processingQueue.drained();
        // console.log("Drained again in total ", new Date().getTime() - dateStarted.getTime() + ' ms');
        // console.log("Stats: ", processingQueue.getStatistics());
        // console.log("Consumers: ", processingQueue.getStatistics(true).consumers);


    });

});


describe('Dir Tree', () => {

    let localResourcesFolder = path.join(__dirname, 'resources');
    // e.g C:\s3uploader\tests\resources
    let dirTreeOptions = {
        attributes: ['mode', 'mtime', 'mtimeMs'],
        normalizePath: true, // So we can use the same paths for S3
    };


    let dirTreeResponse = dirTree(localResourcesFolder, dirTreeOptions);
    // e.g {"path":"C:/s3uploader/tests/resources","name":"resources","mode":16822,"mtime":"2021-01-28T14:38:38.045Z","mtimeMs":1611844718044.9944,"children":[{"path":"C:/s3uploader/tests/resources/1x1.gif","name":"1x1.gif","size":43,"extension":".gif","type":"file","mode":33206,"mtime":"2021-01-09T02:47:30.290Z","mtimeMs":1610160450289.9504}],"size":43,"type":"directory"}

    test('works', () => {
        // console.log("localResourcesFolder: ", localResourcesFolder);
        // console.log("dirTreeResponse: ", JSON.stringify(dirTreeResponse));

        expect(localResourcesFolder).toMatch(/resources$/);
        expect(dirTreeResponse).toBeDefined();
        expect(dirTreeResponse).toEqual({
                "path": expect.any(String), "name": "resources",
                "mode": expect.any(Number),
                "mtime": expect.anything(),
                "mtimeMs": expect.any(Number),
                "size": 43,
                "type": "directory",
                "children":
                    [
                        {
                            "path": expect.any(String),
                            "name": "1x1.gif",
                            "size": 43,
                            "extension": ".gif",
                            "type": "file",
                            "mode": expect.any(Number),
                            "mtime": expect.anything(),
                            "mtimeMs": expect.any(Number)
                        }],
            }
        );
    });
});