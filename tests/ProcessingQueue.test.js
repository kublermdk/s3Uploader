const QueueManager = require('../QueueManager.js');
const QueueConsumer = require('../QueueConsumerS3.js');
const QueueConsumerTest = require('./QueueConsumerTest.js');
const dirTree = require("directory-tree");
const DeferredPromise = require('../DeferredPromise.js');
const path = require('path');
const _ = require('lodash');


// You'll likely want to  `npm install jest --global` to be able to use `npm run test`
// During active development you'll also want to run:
// > npm run test-watch

// Check https://jestjs.io/docs/en/getting-started.html for more information on using Jest tests


// -- Queue Manager Init
let queueManagerOptions = {
    consumerCount: 2,
    consumerClass: QueueConsumerTest, // Required
    consumerInfo: {},
    drainedCheckingTime: 2, // Shortened because we are dealing with very short processes
    removeConsumerTime: 1, // Shortened because we are dealing with very short processes
}

let queueManagerSettingsDefault = queueManagerOptions;
let queueManagerSettingsOne = _.merge({}, queueManagerOptions, {consumerCount: 1});

// -- Dir Tree init
let localResourcesFolder = path.join(__dirname, 'resources');
// e.g C:\s3uploader\tests\resources
let dirTreeOptions = {
    attributes: ['mode', 'mtime', 'mtimeMs'],
    normalizePath: true, // So we can use the same paths for S3
};
let dirTreeResponse = dirTree(localResourcesFolder, dirTreeOptions);

// ====================================================================================
//     Queue Manager
// ====================================================================================

describe('Processing Queue', () => {

    test('is created', () => {

        let queueManager = new QueueManager(queueManagerSettingsDefault);
        expect(queueManager).toBeDefined();
        expect(queueManager.getConsumerCount()).toBe(2);
        expect(queueManager.getStatistics()).toEqual({
            "consumerCount": 2,
            "queueCount": 0,
            "status": "init",
        });
    });


    test('can have a different consumerCount', () => {

        let queueManager = new QueueManager(queueManagerSettingsOne);
        expect(queueManager.getConsumerCount()).toBe(1);
        expect(queueManager.getStatistics()).toEqual({
            "consumerCount": 1,
            "queueCount": 0,
            "status": "init",
        });

    });


    test('is created', () => {

        let queueManager = new QueueManager(queueManagerSettingsDefault);
        expect(queueManager.getQueueCount()).toBe(0);
        queueManager.addToQueue({name: "test"});
        expect(queueManager.getQueueCount()).toBe(1);
        expect(queueManager.getStatistics()).toEqual({
            "consumerCount": 2,
            "queueCount": 1,
            "status": "init",
        });

    });


    test('errors about no Queue Consumer', () => {
        expect(() => {
            new QueueManager();
        }).toThrow("Expecting a valid consumer class, none provided");
    });


    test('accepts an extended Queue Consumer', () => {
        let queueManager = new QueueManager({consumerCount: 1, consumerClass: QueueConsumer});
        expect(queueManager.getStatistics()).toEqual({
            "consumerCount": 1,
            "queueCount": 0,
            "status": "init",
        });
        expect(queueManager.consumers[0]).toBeInstanceOf(QueueConsumer);
    });


    test('settings default', () => {
        let queueManager = new QueueManager(queueManagerSettingsDefault);
        expect(queueManager.settings).toEqual({
            "activityLength": 100,
            "ident": expect.any(Number),
        });
        expect(queueManager.consumers[0].settings).toEqual({
            "activityLength": 100,
            "ident": expect.any(String),
        });

    });


    test('settings flow through', () => {
        let queueManager = new QueueManager(queueManagerSettingsOne, {"activityLength": 1});
        expect(queueManager.settings).toEqual({
            "activityLength": 1,
            "ident": expect.any(Number),
        });
        expect(queueManager.consumers[0].settings).toEqual({
            "activityLength": 1,
            "ident": expect.any(String),
        });

    });


    test('runs on start', async () => {

        queueManager = new QueueManager(queueManagerSettingsDefault);
        // let queueManager = new QueueManager(queueManagerSettingsOne);
        queueManager.addToQueue({name: "test 1"});
        queueManager.addToQueue({name: "test 2"});
        queueManager.addToQueue({name: "test 3"});
        queueManager.addToQueue({name: "test 4"});
        let queueProcessed5Promise = queueManager.addToQueue({name: "test 5"});
        console.log(queueProcessed5Promise);

        expect(queueProcessed5Promise).toBeInstanceOf(DeferredPromise);
        expect(queueProcessed5Promise._promise).toBeInstanceOf(Promise);
        console.log(queueProcessed5Promise._promise);

        let dateStarted = new Date();
        queueManager.start();
        // expect.assertions(3);
        expect(queueManager.getStatistics()).toEqual({
            "consumerCount": expect.any(Number),
            "queueCount": expect.any(Number),
            "status": "started",
        });

        expect(queueProcessed5Promise).toBeInstanceOf(DeferredPromise);
        let hasDrained = await queueManager.drained();
        expect(hasDrained).toBeTruthy();
        expect(hasDrained).toEqual(true);
        console.log("Drained in ", new Date().getTime() - dateStarted.getTime() + ' ms');

        expect(queueProcessed5Promise).resolves.toEqual({
            name: "test 5",
            __completedQueueTaskPromise: expect.any(DeferredPromise),
            processed: true,
        });

        let queueProcessed5resolved = await queueProcessed5Promise;
        expect(queueProcessed5resolved).toEqual({
            name: "test 5",
            __completedQueueTaskPromise: expect.any(DeferredPromise),
            processed: true,
        });

    });


    test('runs if queue is added after start', async () => {
        let queueManager = new QueueManager(queueManagerSettingsDefault);
        // let queueManager = new QueueManager(queueManagerSettingsOne);

        // let dateStarted = new Date();
        queueManager.start();
        queueManager.addToQueue({name: "test 1"});
        queueManager.addToQueue({name: "test 2"});
        queueManager.addToQueue({name: "test 3"});

        expect(queueManager.getStatistics()).toEqual({
            "consumerCount": expect.any(Number),
            "queueCount": expect.any(Number),
            "status": "started",
        });

        let hasDrained = await queueManager.drained();
        expect(hasDrained).toEqual(true);
        // console.log("Drained in ", new Date().getTime() - dateStarted.getTime() + ' ms');
        queueManager.addToQueue({name: "test 3"});
        await queueManager.drained();
        // console.log("Drained again in total ", new Date().getTime() - dateStarted.getTime() + ' ms');
        // console.log("Stats: ", queueManager.getStatistics());
        // console.log("Consumers: ", queueManager.getStatistics(true).consumers);


    });

});


// ====================================================================================
//     Dir Tree
// ====================================================================================
describe('Dir Tree', () => {


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


// ====================================================================================
//     S3 uploader (Queue Consumer)
// ====================================================================================
describe('S3 uploading consumer works', () => {

    test('1x1.gif uploads', () => {
        // Make sure we are only processing a single 1x1.gif
        expect(dirTreeResponse.children.length).toEqual(1);
        expect(dirTreeResponse.children[0].name).toEqual("1x1.gif");

        let s3ConsumerSettings = {
            consumerCount: 1,
            consumerClass: QueueConsumer, // Required
            consumerInfo: {

            },
            drainedCheckingTime: 20, // Shortened because we are dealing with very short processes
            removeConsumerTime: 10, // Shortened because we are dealing with very short processes
        }

    });

});