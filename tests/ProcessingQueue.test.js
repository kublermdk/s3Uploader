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
    removeConsumerTime: 50, // Shortened because we are dealing with very short processes
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


/**
 * Wait Time
 *
 * Wait a certain amount of time then resolve the promise, good for
 * @example await waitTime(1);
 * @example await waitTime(100);
 * @param waitMs
 * @returns {Promise<unknown>}
 */
let waitTime = (waitMs = 1) => {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve(true);
        }, waitMs);
    });
}

let waitImmediate = () => {
    return new Promise((resolve, reject) => {
        setImmediate(() => {
            resolve(true);
        });
    });
}

describe('Processing Queue', () => {

    test('is created', () => {

        let queueManager = new QueueManager(queueManagerSettingsDefault);
        expect(queueManager).toBeDefined();
        expect(queueManager.getConsumerCount()).toBe(2);
        expect(queueManager.getStatistics()).toEqual({
            consumerCount: 2,
            queueCount: 0,
            status: "init",
        });
    });


    test('can have a different consumerCount', () => {

        let queueManager = new QueueManager(queueManagerSettingsOne);
        expect(queueManager.getConsumerCount()).toBe(1);
        expect(queueManager.getStatistics()).toEqual({
            consumerCount: 1,
            queueCount: 0,
            status: "init",
        });

    });


    test('is created', () => {

        let queueManager = new QueueManager(queueManagerSettingsDefault);
        expect(queueManager.getQueueCount()).toBe(0);
        queueManager.addToQueue({name: "test"});
        expect(queueManager.getQueueCount()).toBe(1);
        expect(queueManager.getStatistics()).toEqual({
            consumerCount: 2,
            queueCount: 1,
            status: "init",
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
            consumerCount: 1,
            queueCount: 0,
            status: "init",
        });
        expect(queueManager.consumers[0]).toBeInstanceOf(QueueConsumerS3);
    });


    test('settings default', () => {
        let queueManager = new QueueManager(queueManagerSettingsDefault);
        expect(queueManager.settings).toEqual({
            activityLength: 5000,
            ident: expect.any(Number),
        });
        expect(queueManager.consumers[0].settings).toEqual({
            activityLength: 5000,
            ident: expect.any(String),
        });

    });


    test('settings flow through', () => {
        let queueManager = new QueueManager(queueManagerSettingsOne, {activityLength: 1});
        expect(queueManager.settings).toEqual({
            activityLength: 1,
            ident: expect.any(Number),
        });
        expect(queueManager.consumers[0].settings).toEqual({
            activityLength: 1,
            ident: expect.any(String),
        });

    });


    test('activityLength is shortened', () => {
        let queueManager = new QueueManager(queueManagerSettingsOne, {activityLength: 2});

        // console.log(queueManager.consumers[0].activity);
        // NB: The consumer will already have some activity (being set from init to starting)
        let consumer = queueManager.consumers[0];

        let activityQueueInit = consumer.activity.length;
        let addActivityResponse1 = consumer.addActivity('Test message 1');
        let addActivityResponse2 = consumer.addActivity('Test message 2');
        let addActivityResponse3 = consumer.addActivity('Test message 3');

        expect(queueManager.consumers[0].settings).toEqual({
            activityLength: 2,
            ident: expect.any(String),
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
        let queueManager = new QueueManager(queueManagerSettingsOne, {activityLength: 0});
        let addActivityResponse = queueManager.consumers[0].addActivity('Test message');

        expect(queueManager.consumers[0].settings).toEqual({
            activityLength: 0,
            ident: expect.any(String),
        });
        expect(addActivityResponse).toEqual(0);
        expect(queueManager.consumers[0].activity.length).toEqual(0);
    });


    test('activityLength false isn\'t shortened, it grows forever', () => {
        let queueManager = new QueueManager(queueManagerSettingsOne, {activityLength: false});
        expect(queueManager.consumers[0].settings).toEqual({
            activityLength: false,
            ident: expect.any(String),
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

        let queueManager = new QueueManager(queueManagerSettingsDefault);
        // let queueManager = new QueueManager(queueManagerSettingsOne);
        queueManager.addToQueue({name: "test 1"});
        queueManager.addToQueue({name: "test 2"});
        queueManager.addToQueue({name: "test 3"});
        let queueProcessed4promise = queueManager.addToQueue({name: "test 4"});

        expect(queueProcessed4promise).toBeInstanceOf(DeferredPromise);
        expect(queueProcessed4promise._promise).toBeInstanceOf(Promise);

        // let dateStarted = new Date();
        queueManager.start();
        // let queueProcessed5response = await queueManager.addToQueue({name: "test 5"}); // Can't await for a queue task if the queue hasn't started otherwise it just times out
        let queueProcessed5promise = queueManager.addToQueue({name: "test 5"}); // Can't await for a queue task if the queue hasn't started otherwise it just times out

        // expect.assertions(3);
        expect(queueManager.getStatistics()).toEqual({
            consumerCount: expect.any(Number),
            queueCount: expect.any(Number),
            status: "started",
        });


        // console.log("Drained in ", new Date().getTime() - dateStarted.getTime() + ' ms');

        await expect(queueProcessed5promise).resolves.toEqual({
            name: "test 5",
            __completedQueueTaskPromise: expect.any(DeferredPromise),
            processed: true,
        });

        let hasDrained = await queueManager.drained();
        expect(hasDrained).toEqual(true);


    });


    test('runs if queue is added after start', async () => {
        let queueManager = new QueueManager(queueManagerSettingsDefault);
        queueManager.start();
        queueManager.addToQueue({name: "test 1"});

        expect(queueManager.getStatistics()).toEqual({
            consumerCount: expect.any(Number),
            queueCount: expect.any(Number),
            status: "started",
        });

        let hasDrained = await queueManager.drained();
        expect(hasDrained).toEqual(true);
        let queueProcessResult = await queueManager.addToQueue({name: "test 2"});
        // expect(queueProcessResult).toEqual({});

    });

    test('array splice', () => {
        let consumers = [0, 1, 2, 3, 4, 5, 6, 7];
        expect(consumers.length).toEqual(8);
        consumers.splice(0, 1); // Remove 0 the first entry
        expect(consumers.length).toEqual(7);
        consumers.splice(2, 1); // Remove what is now 3 (at index 2 or the 3rd entry along)
        expect(consumers.length).toEqual(6);
        expect(consumers).toEqual([1, 2, 4, 5, 6, 7]);

    })

    test('removing and adding consumers before starting', async () => {
        let queueManager = new QueueManager(queueManagerSettingsDefault);
        expect(queueManager.consumers.length).toEqual(2);

        let dateStartRemoving = new Date();
        let removeConsumerNotStarted = await queueManager.removeConsumer();
        await waitImmediate();
        expect(queueManager.consumers.length).toEqual(1);
        expect(removeConsumerNotStarted).toEqual(0); // It will see and remove the first entry which is the index number it returns

        queueManager.addConsumer();
        queueManager.addConsumer();
        expect(queueManager.consumers.length).toEqual(3);
        let removeConsumerIndex = await queueManager.removeConsumer();

        expect(removeConsumerIndex).toEqual(0); // Not started, so again it'll be at index 0 that it's removed
        expect(queueManager.consumers.length).toEqual(2);
        expect(queueManager.consumersCreated).toEqual(4);

    });

    //
    test('removing and adding consumers after starting', async () => {
        let queueManager = new QueueManager(queueManagerSettingsDefault);
        queueManager.start();
        queueManager.addToQueue({message: 'Initial Test 1'});
        await queueManager.addToQueue({message: 'Initial Test 2'});
        _.each(_.range(0, 3), (index) => {
            queueManager.addToQueue({message: 'Test message ' + index});
        });
        await waitImmediate(); // Give it all long enough for the processes to be farmed out

        expect(queueManager.consumers.length).toEqual(2);
        expect(queueManager.findIdleConsumerIndex()).toEqual(-1);

        let removeConsumerIndex = await queueManager.removeConsumer();
        expect(removeConsumerIndex).toBeGreaterThanOrEqual(0);
        expect(queueManager.consumers.length).toEqual(1);

    });
});


// ====================================================================================
//     Dir Tree
// ====================================================================================
describe('Dir Tree', () => {


    // e.g {path:"C:/s3uploader/tests/resources",name:"resources",mode:16822,mtime:"2021-01-28T14:38:38.045Z",mtimeMs:1611844718044.9944,children:[{path:"C:/s3uploader/tests/resources/1x1.gif",name:"1x1.gif",size:43,extension:".gif",type:"file",mode:33206,mtime:"2021-01-09T02:47:30.290Z",mtimeMs:1610160450289.9504}],size:43,type:"directory"}

    test('works', () => {

        // console.debug("The dirTreeResponse is: ", JSON.stringify(dirTreeResponse));
        expect(localResourcesFolder).toMatch(/resources$/);
        expect(dirTreeResponse).toBeDefined();
        expect(dirTreeResponse).toEqual({
                path: expect.any(String),
                name: "resources",
                mode: expect.any(Number),
                mtime: expect.anything(),
                mtimeMs: expect.any(Number),
                size: 43,
                type: "directory",
                children:
                    [
                        {
                            basePath: expect.any(String), // Inserted by our own code, not by dirTree
                            path: expect.any(String),
                            name: "1x1.gif",
                            size: 43,
                            extension: ".gif",
                            type: "file",
                            mode: expect.any(Number),
                            mtime: expect.anything(),
                            mtimeMs: expect.any(Number)
                        }],
            }
        );
    });
});


// ====================================================================================
//     S3 uploader (Queue Consumer)
// ====================================================================================
describe('S3 uploading consumer', () => {


    // @todo: Convert this into a beforeAll() method.
    let s3ConsumerSettings = {
        consumerCount: 1,
        consumerClass: QueueConsumerS3, // The s3 queue Consumer
        consumerConfig: {
            AWS_PROFILE: process.env.AWS_PROFILE_TESTING,
            AWS_S3_BUCKET: process.env.AWS_S3_BUCKET_TESTING,
            AWS_S3_BUCKET_FOLDER: process.env.AWS_S3_BUCKET_FOLDER_TESTING,
            AWS_REGION: process.env.AWS_REGION,
            OVERWRITE: false, // Overwrite the file anyway
            OVERWRITE_EXISTING_IF_DIFFERENT: true
        },
        drainedCheckingTime: 20, // Shortened because we are dealing with very short processes
        removeConsumerTime: 10, // Shortened because we are dealing with very short processes
    }
    let queueManager = new QueueManager(s3ConsumerSettings);

    const queueEntry = dirTreeResponse.children[0];
    queueEntry.basePath = dirTreeResponse.path;
    const Key = s3ConsumerSettings.consumerConfig.AWS_S3_BUCKET_FOLDER + "/1x1.gif";
    const Location = `https://${s3ConsumerSettings.consumerConfig.AWS_S3_BUCKET}.s3.${s3ConsumerSettings.consumerConfig.AWS_REGION}.amazonaws.com/${Key}`;

    test('default configuration gets applied', () => {
        expect(queueManager.consumers[0].config).toEqual(_.merge({}, s3ConsumerSettings.consumerConfig, queueManager.consumers[0].defaultConfig));
        // console.debug('queueManager.consumers[0].config: ', queueManager.consumers[0].config);
    });

    test('workOutS3PartSize method works as expected', () => {
        expect(queueManager.consumers[0].workOutS3PartSize({size: 100})).toEqual(10485760); // A 100 byte file should easily fit in 10MB (10485760 = 10 * 1024 * 1024 )
        expect(queueManager.consumers[0].workOutS3PartSize({size: 11 * 1024 * 1024})).toEqual(10485760); // An 11MB byte file should still be 10MB parts
        expect(queueManager.consumers[0].workOutS3PartSize({size: 600 * 1024 * 1024 * 1024})).toEqual(64437397); // A 600GB file is 644,245,094,400 Bytes = 600 * 1024 * 1024 * 1024 which when split into 9998 parts is 64Mb (64437396.91938388 rounded up to  64437397)
    });


    // --------------------------------------------------------------
    //   shouldUploadFile
    // --------------------------------------------------------------
    describe('shouldUploadFile', () => {


        let s3ListObject = {
            IsTruncated: false,
            Contents: [{
                Key: "testing/1x1.gif",
                Size: 64,
                LastModified: "2021-01-31T06:44:53.000Z",
                ETag: '"d41d8cd98f00b204e9999999fff8427e"',
                StorageClass: "STANDARD"
            }],
            Name: "testing-s3uploader",
            Prefix: "testing/1x1.gif",
            MaxKeys: 1,
            CommonPrefixes: [],
            KeyCount: 1
        };
        let s3ListObjectNoFile = {
            Contents: [],
            Prefix: "testing/1x1.gif",
        };
        let fsStat = {
            dev: 1733172691,
            mode: 33206,
            nlink: 1,
            uid: 0,
            gid: 0,
            rdev: 0,
            blksize: 4096,
            ino: 50665495808138510,
            size: 43, // Actually the correct size
            blocks: 0,
            atimeMs: 1612086167975.0261,
            mtimeMs: 1610160450289.9504,
            ctimeMs: 1610160450289.9504,
            birthtimeMs: 1610160449423.793,
            atime: new Date('2021-01-31T09:42:47.975Z'), // Access Time
            mtime: new Date('2021-01-09T02:47:30.290Z'), // Modified Time
            ctime: new Date('2021-01-09T02:47:30.290Z'), // Change Time (inode data modification e.g chmod, chown, rename, link)
            birthtime: new Date('2021-01-09T02:47:29.424Z'), // When the file was created
        };
        let fsStatSameSize = _.merge({}, fsStat, {size: s3ListObject.Contents[0].Size});
        let sha256OfLocalFile = '3331a0486cb3e8a75c8c2fdf02bf80fd8fe2b811dfe5c7b4aa892d38bfcf604a';
        let s3ObjectTags = {
            TagSet: [{
                Key: "s3UploaderSHA256",
                Value: "3331a0486cb3e8a75c8c2fdf02bf80fd8fe2b811dfe5c7b4aa892d38bfcf604a"
            }]
        };
        let s3ObjectTagsDifferentSha = _.merge({}, s3ObjectTags);
        s3ObjectTagsDifferentSha.TagSet[0].Value = 'INVALIDSHA256aaaa3331a0486cbc8c2fdf02bf80fd8f7b4aa892d38bfcf604a';
        let s3ObjectNoTags = {
            TagSet: []
        }


        test('OVERWRITE_EXISTING_IF_DIFFERENT and filesize different', async () => {
            let shouldUploadTrue = await queueManager.consumers[0].shouldUploadFile(s3ListObject, fsStat, sha256OfLocalFile, s3ObjectTags);
            expect(shouldUploadTrue).toEqual(true);
            expect(_.last(queueManager.consumers[0].activity).message).toEqual('shouldUploadFile() You should replace the existing file upload because OVERWRITE_EXISTING_IF_DIFFERENT is true and the filesize on S3 is 64 but on the local filesystem it is 43');
        });

        test('new file (fileEntryS3 is empty)', async () => {
            await expect(queueManager.consumers[0].shouldUploadFile(s3ListObjectNoFile, fsStat, sha256OfLocalFile, s3ObjectTags)).resolves.toEqual(true);
            expect(_.last(queueManager.consumers[0].activity).message).toEqual('shouldUploadFile() fileEntryS3 is empty, the file testing/1x1.gif hasn\'t been uploaded yet so uploading it');
        });


        test('SHA is different', async () => {
            expect(await queueManager.consumers[0].shouldUploadFile(s3ListObject, fsStatSameSize, sha256OfLocalFile, s3ObjectTagsDifferentSha)).toEqual(true);
            expect(_.last(queueManager.consumers[0].activity).message).toEqual('shouldUploadFile() replacing the existing file upload because OVERWRITE_EXISTING_IF_DIFFERENT is true and the SHA of the files is different. The s3 Sha256 is INVALIDSHA256aaaa3331a0486cbc8c2fdf02bf80fd8f7b4aa892d38bfcf604a but on the local filesystem it is 3331a0486cb3e8a75c8c2fdf02bf80fd8fe2b811dfe5c7b4aa892d38bfcf604a');
        });

        test('SHA is the same (so don\'t overwrite)', async () => {
            expect(await queueManager.consumers[0].shouldUploadFile(s3ListObject, fsStatSameSize, sha256OfLocalFile, s3ObjectTags)).toEqual(false);
            expect(_.last(queueManager.consumers[0].activity).message).toEqual('shouldUploadFile() NOT replacing the existing file upload because OVERWRITE_EXISTING_IF_DIFFERENT is true but the the SHA of the files is the same 3331a0486cb3e8a75c8c2fdf02bf80fd8fe2b811dfe5c7b4aa892d38bfcf604a');
        });

        test('Not SHA and not newly modified', async () => {
            await expect(queueManager.consumers[0].shouldUploadFile(s3ListObject, fsStatSameSize, sha256OfLocalFile, s3ObjectNoTags)).resolves.toEqual(false);
            expect(_.last(queueManager.consumers[0].activity).message).toEqual('shouldUploadFile() OVERWRITE_EXISTING_IF_DIFFERENT is true but there\'s no SHA but the s3 file is up to date with local according to the modified timestamp');
        });

        test('Not SHA but is newly modified', async () => {
            // lastModifiedLocalDate: new Date('2021-01-09T02:47:30.290Z') // Original
            // lastModifiedS3Date: new Date('2021-01-31T06:44:53.000Z')  // What we need to be more recent than
            let fsStatSameSizeNewlyModified = _.merge({}, fsStatSameSize, {mtime: new Date('2021-02-02T02:22:22.222Z')});
            await expect(queueManager.consumers[0].shouldUploadFile(s3ListObject, fsStatSameSizeNewlyModified, sha256OfLocalFile, s3ObjectNoTags)).resolves.toEqual(true);
            expect(_.last(queueManager.consumers[0].activity).message).toEqual('shouldUploadFile() You should replace the existing file upload because OVERWRITE_EXISTING_IF_DIFFERENT is true and the local file was modified more recently then that file on S3');
        });

        // Not sure why but if this is before other normal queueManager tests then it breaks them
        test('OVERWRITE is true', async () => {
            let s3ConsumerSettingsOverwriteTrue = _.merge({}, s3ConsumerSettings, {consumerConfig: {OVERWRITE: true}});
            let queueManagerTest = new QueueManager(s3ConsumerSettingsOverwriteTrue);
            await expect(queueManagerTest.consumers[0].shouldUploadFile(s3ListObject, fsStatSameSize, sha256OfLocalFile, s3ObjectTags)).resolves.toEqual(true);
            expect(_.last(queueManagerTest.consumers[0].activity).message).toEqual('shouldUploadFile() OVERWRITE config is true, so overwriting testing/1x1.gif');
        });


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

        // -- We want to ensure the file is overwritten even if it exists
        let s3ConsumerSettingsOverwriteTrue = _.merge({}, s3ConsumerSettings, {consumerConfig: {OVERWRITE: true}});
        expect(s3ConsumerSettingsOverwriteTrue.consumerConfig.OVERWRITE).toEqual(true);
        queueManager = new QueueManager(s3ConsumerSettingsOverwriteTrue); // Reset it in case the other tests have modified the consumer, etc..
        expect(queueManager.consumers.length).toEqual(1);
        queueManager.start();

        // -- Actually process the queue!
        let entryResult = await queueManager.addToQueue(queueEntry).catch(err => {
            console.error("=== TESTING ERROR == ", err);
            expect('It errored').toBe(err);
        }); // NB: This doesn't resolve if the queueManger isn't started already

        await queueManager.drained();

        expect(entryResult).toEqual({
            uploaded: true,
            localFilePath: expect.any(String),
            data: {
                Bucket: s3ConsumerSettings.consumerConfig.AWS_S3_BUCKET,
                Key,
                key: Key,
                Location,
                ETag: expect.any(String), // e.g "d41d8cd98f00b204e9800998ecf8427e"
                ServerSideEncryption: expect.any(String), // If you have it enabled it's likely AES256
            },
            uploadProcessingTime: expect.any(String), // e.g "0.908s"
            queueEntry: expect.anything(),
            uploadOptions: {
                partSize: 10485760,
                queueSize: 4,
                tags: [
                    {
                        Key: "s3UploaderSHA256",
                        Value: "3331a0486cb3e8a75c8c2fdf02bf80fd8fe2b811dfe5c7b4aa892d38bfcf604a",
                    },
                ],
            },
            processingTime: expect.any(String), // e.g "1.911s"
            s3ListObject: {
                CommonPrefixes: [],
                Contents: [
                    {
                        ETag: expect.any(String), // e.g  "\"968c3ad2d1184fee0bf0dd479f7904b7\""
                        Key: "testing/1x1.gif",
                        LastModified: expect.any(Date), // e.g Date('2021-02-06T18:08:00.000Z')
                        Size: 43,
                        StorageClass: "STANDARD",
                    },
                ],
                IsTruncated: false,
                KeyCount: 1,
                MaxKeys: 1,
                Name: "testing-s3uploader",
                Prefix: "testing/1x1.gif",
            },
            s3ObjectTags: {
                TagSet: [
                    {
                        Key: "s3UploaderSHA256",
                        Value: "3331a0486cb3e8a75c8c2fdf02bf80fd8fe2b811dfe5c7b4aa892d38bfcf604a",
                    },
                ],
            },
            sha256OfLocalFile: "3331a0486cb3e8a75c8c2fdf02bf80fd8fe2b811dfe5c7b4aa892d38bfcf604a",
        });

        await queueManager.drained(); // Want to see the consumers status be set to idle

    });

    test('same 1x1.gif doesn\'t get overridden', async () => {

        let s3ConsumerSettingsDontOverwrite = _.merge({}, s3ConsumerSettings, {
            consumerInfo: {
                OVERWRITE: false,
                OVERWRITE_EXISTING_IF_DIFFERENT: true,
            }
        }); // It should be false anyway

        expect(s3ConsumerSettingsDontOverwrite.consumerInfo.OVERWRITE).toEqual(false);
        expect(s3ConsumerSettingsDontOverwrite.consumerInfo.OVERWRITE_EXISTING_IF_DIFFERENT).toEqual(true);
        queueManager = new QueueManager(s3ConsumerSettingsDontOverwrite, {OUTPUT_ERRORS: false,});
        queueManager.start();

        await expect(queueManager.addToQueue(queueEntry)).resolves.toEqual({
            uploaded: false,
            shouldUploadFile: false,
            localFilePath: expect.any(String), // e.g "C:\\s3uploader\\tests\\resources\\1x1.gif",
            processingTime: expect.any(String), // e.g "0.947s",
            s3ListObject: {
                CommonPrefixes: [],
                Contents: [
                    {
                        ETag: expect.any(String),// e.g "\"968c3ad2c1183fee0bf0dd479f7904b7\"",
                        Key: "testing/1x1.gif",
                        LastModified: expect.any(Date), //e .g Date('2021-02-06T18:12:20.000Z'),
                        Size: 43,
                        StorageClass: "STANDARD"
                    }
                ],
                IsTruncated: false,
                KeyCount: 1,
                MaxKeys: 1,
                Name: "testing-s3uploader",
                Prefix: "testing/1x1.gif"
            },
            s3ObjectTags: {
                TagSet: [
                    {
                        Key: "s3UploaderSHA256",
                        Value: "3331a0486cb3e8a75c8c2fdf02bf80fd8fe2b811dfe5c7b4aa892d38bfcf604a"
                    }
                ]
            },
            sha256OfLocalFile: "3331a0486cb3e8a75c8c2fdf02bf80fd8fe2b811dfe5c7b4aa892d38bfcf604a",
            queueEntry: {
                __completedQueueTaskPromise: expect.anything(),
                basePath: expect.any(String),// e.g "C:/s3uploader/tests/resources",
                extension: ".gif",
                mode: expect.anything(), // e.g 33206,
                mtime: expect.anything(),
                mtimeMs: expect.any(Number), // e.g 1610160450289.9504,
                name: "1x1.gif",
                path: expect.any(String), // e.g "C:/s3uploader/tests/resources/1x1.gif",
                size: 43,
                type: "file"
            },
        });
    });


    test('invalid file fails', async () => {

        let s3ConsumerSettingsDontOverwrite = _.merge({}, s3ConsumerSettings, {
            consumerInfo: {
                OVERWRITE: false,
                OVERWRITE_EXISTING_IF_DIFFERENT: true,
                OUTPUT_ERRORS: false,
            }
        });
        let invalidQueueEntry = _.merge({}, queueEntry, {
            path: path.join(__dirname, '123456789 this is an invalid_file.notAtxt'),
            name: '123456789 this is an invalid_file.notAtxt'
        });
        queueManager = new QueueManager(s3ConsumerSettingsDontOverwrite, {OUTPUT_ERRORS: false,});
        queueManager.start();
        return expect(queueManager.addToQueue(invalidQueueEntry)).rejects.toEqual({
            mainError: expect.anything()
        });
        // e.g
        // Error({
        //     code: "ENOENT",
        //     errno: -4058,
        //     path: invalidQueueEntry.path,
        //     syscall: "stat",
        // })


    });

    test.todo('Setup console logging of the activity log entries');
    test.todo('Get custom queue consumer\'s being included if they can be found?');
    test.todo('Setup DELETE_ON_UPLOAD');
})
;