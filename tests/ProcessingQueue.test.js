const QueueManager = require('../QueueManager.js');
const QueueConsumerS3 = require('../QueueConsumerS3.js');
const QueueConsumerTest = require('./QueueConsumerTest.js');
const dirTree = require("directory-tree");
const DeferredPromise = require('../DeferredPromise.js');
const path = require('path');
const _ = require('lodash');
require('dotenv').config(); // Load env vars https://www.npmjs.com/package/dotenv

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
        let queueManager = new QueueManager({consumerCount: 1, consumerClass: QueueConsumerS3});
        expect(queueManager.getStatistics()).toEqual({
            "consumerCount": 1,
            "queueCount": 0,
            "status": "init",
        });
        expect(queueManager.consumers[0]).toBeInstanceOf(QueueConsumerS3);
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


    test('activityLength is shortened', () => {
        let queueManager = new QueueManager(queueManagerSettingsOne, {"activityLength": 2});

        // console.log(queueManager.consumers[0].activity);
        // NB: The consumer will already have some activity (being set from init to starting)
        let consumer = queueManager.consumers[0];

        let activityQueueInit = consumer.activity.length;
        let addActivityResponse1 = consumer.addActivity('Test message 1');
        let addActivityResponse2 = consumer.addActivity('Test message 2');
        let addActivityResponse3 = consumer.addActivity('Test message 3');

        expect(queueManager.consumers[0].settings).toEqual({
            "activityLength": 2,
            "ident": expect.any(String),
        });

        expect(activityQueueInit).toEqual(1);
        expect(addActivityResponse1).toEqual(2);
        expect(addActivityResponse2).toEqual(2);
        expect(addActivityResponse3).toEqual(2);
        expect(queueManager.consumers[0].activity.length).toEqual(2);
        // Ensure we are seeing only the latest messages, not the older ones
        expect(queueManager.consumers[0].activity).toEqual([
            {date: expect.any(Date), data: null, message: 'Test message 2'},
            {date: expect.any(Date), data: null, message: 'Test message 3'}
        ]);
    });


    test('activityLength 0 doesn\'t add any activity', () => {
        let queueManager = new QueueManager(queueManagerSettingsOne, {"activityLength": 0});
        let addActivityResponse = queueManager.consumers[0].addActivity('Test message');

        expect(queueManager.consumers[0].settings).toEqual({
            "activityLength": 0,
            "ident": expect.any(String),
        });
        expect(addActivityResponse).toEqual(0);
        expect(queueManager.consumers[0].activity.length).toEqual(0);
    });


    test('activityLength false isn\'t shortened, it grows forever', () => {
        let queueManager = new QueueManager(queueManagerSettingsOne, {"activityLength": false});
        expect(queueManager.consumers[0].settings).toEqual({
            "activityLength": false,
            "ident": expect.any(String),
        });

        // NB: The consumer will already have some activity (being set from init to starting)
        let consumer = queueManager.consumers[0];
        _.each(_.range(0, 199), (index) => {
            consumer.addActivity('Test message ' + index);
        });

        // We expect to see all 200 activity messages
        expect(queueManager.consumers[0].activity.length).toEqual(200);
    });


    test('runs on start', async () => {

        queueManager = new QueueManager(queueManagerSettingsDefault);
        // let queueManager = new QueueManager(queueManagerSettingsOne);
        queueManager.addToQueue({name: "test 1"});
        queueManager.addToQueue({name: "test 2"});
        queueManager.addToQueue({name: "test 3"});
        queueManager.addToQueue({name: "test 4"});
        let queueProcessed5Promise = queueManager.addToQueue({name: "test 5"});

        expect(queueProcessed5Promise).toBeInstanceOf(DeferredPromise);
        expect(queueProcessed5Promise._promise).toBeInstanceOf(Promise);

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
        // console.log("Drained in ", new Date().getTime() - dateStarted.getTime() + ' ms');

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

        let dateStarted = new Date();
        queueManager.start();
        queueManager.addToQueue({name: "test 1"});
        // queueManager.addToQueue({name: "test 2"});
        // queueManager.addToQueue({name: "test 3"});

        expect(queueManager.getStatistics()).toEqual({
            "consumerCount": expect.any(Number),
            "queueCount": expect.any(Number),
            "status": "started",
        });

        let hasDrained = await queueManager.drained();
        expect(hasDrained).toEqual(true);
        // console.log("Drained in ", new Date().getTime() - dateStarted.getTime() + ' ms');
        await queueManager.addToQueue({name: "test 2"});

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

    let s3ConsumerSettings = {
        consumerCount: 1,
        consumerClass: QueueConsumerS3, // The s3 queue Consumer
        consumerConfig: {
            AWS_PROFILE: process.env.AWS_PROFILE_TESTING,
            AWS_S3_BUCKET: process.env.AWS_S3_BUCKET_TESTING,
            AWS_S3_BUCKET_FOLDER: process.env.AWS_S3_BUCKET_FOLDER_TESTING,
            AWS_REGION: process.env.AWS_REGION,
            OVERWRITE_FILE: true, // Overwrite the file anyway
            OVERWRITE_EXISTING_IF_DIFFERENT: true
        },
        drainedCheckingTime: 20, // Shortened because we are dealing with very short processes
        removeConsumerTime: 10, // Shortened because we are dealing with very short processes
    }
    let queueEntry = dirTreeResponse.children[0];
    let Key = s3ConsumerSettings.consumerConfig.AWS_S3_BUCKET_FOLDER + "/1x1.gif";
    let Location =  `https://${s3ConsumerSettings.consumerConfig.AWS_S3_BUCKET}.s3.${s3ConsumerSettings.consumerConfig.AWS_REGION}.amazonaws.com/${Key}`;
    test('s3 consumer default configuration got applied', () => {
        let queueManager = new QueueManager(s3ConsumerSettings);
        expect(queueManager.consumers[0].config).toEqual(_.merge({
            OVERWRITE_EXISTING_IF_DIFFERENT: true,
            OVERWRITE: false,
            S3_UPLOAD_OPTIONS_STORAGE_CLASS: 'STANDARD',
            S3_UPLOAD_OPTIONS_PART_SIZE: 10485760,
            S3_UPLOAD_ACL: 'bucket-owner-full-control'

        }, s3ConsumerSettings.consumerConfig));
        console.debug(queueManager.consumers[0].config);

    });

    test('1x1.gif uploads', async () => {
        // Make sure we are only processing a single 1x1.gif
        expect(dirTreeResponse.children.length).toEqual(1);
        expect(dirTreeResponse.children[0].name).toEqual("1x1.gif");


        expect(process.env.AWS_PROFILE_TESTING).toBeDefined();
        expect(process.env.AWS_S3_BUCKET_TESTING).toBeDefined();
        expect(process.env.AWS_S3_BUCKET_FOLDER_TESTING).toBeDefined();

        // e.g in .env you might have:
        // AWS_PROFILE_TESTING=testing
        // AWS_S3_BUCKET_TESTING=testing-s3uploader
        // AWS_S3_BUCKET_FOLDER_TESTING=testing


        queueEntry.basePath = dirTreeResponse.path;

        let queueManager = new QueueManager(s3ConsumerSettings);
        queueManager.start();
        let entryResult = await queueManager.addToQueue(queueEntry); // NB: This doesn't resolve if the queueManger isn't started already


        expect(entryResult).toEqual({
            localFilePath: expect.any(String),
            data: {
                Bucket: s3ConsumerSettings.consumerConfig.AWS_S3_BUCKET,
                Key,
                Location,
                ETag: expect.any(String), // e.g "d41d8cd98f00b204e9800998ecf8427e"
                ServerSideEncryption: expect.any(String), // If you have it enabled it's likely AES256
            },
            uploadProcessingTime: expect.any(Number), // e.g 4123
            treeEntry: expect.anything(),
        });

        await queueManager.drained(); // Want to see the consumers status be set to idle
        console.log('Uploaded the 1x1.gif activity: ', queueManager.consumers[0].getActivity());

    });

    // test('same 1x1.gif doesn\'t get overridden', async () => {
    //
    //     let s3ConsumerSettingsDontOverwrite = _.merge({}, s3ConsumerSettings, {consumerInfo: {OVERWRITE_FILE: false}});
    //     let queueManager = new QueueManager(s3ConsumerSettingsDontOverwrite);
    //     queueManager.start();
    //     let entryResult = await queueManager.addToQueue(queueEntry); // NB: This doesn't resolve if the queueManger isn't started already
    //     expect(entryResult).toEqual({
    //         localFilePath: expect.any(String),
    //         data: {
    //             Bucket: s3ConsumerSettings.consumerConfig.AWS_S3_BUCKET,
    //             Key,
    //             Location,
    //             ETag: expect.any(String), // e.g "d41d8cd98f00b204e9800998ecf8427e"
    //             ServerSideEncryption: expect.any(String), // If you have it enabled it's likely AES256
    //         },
    //         uploadProcessingTime: expect.any(Number), // e.g 4123
    //         treeEntry: expect.anything(),
    //     });
    //
    // });

});