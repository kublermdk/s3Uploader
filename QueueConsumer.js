/**
 *
 * The queue processor class should:
 * Obviously contain a queue.
 * Contain the queue consumers
 *
 * The consumers should be able to grab the next entry from the queue when they've completed their processing.
 * If the queue is empty then adding to the queue should automatically send an entry to a waiting consumer
 * This means we need to be able to ask the consumer the state - Is it processing, idle or errored?
 *
 * You should be able to specify how many consumers are to beb created
 * You should be able to specify the consumer factory class
 *
 * You should be able to send a signal to the script and
 * the consumers will complete what processing they are doing
 * but not get any more entries from the queue
 *
 * Graceful Exit - One signal will mean they complete processing then exit
 * Pause - Another signal means they will complete processing then wait
 * Play - With a 3rd signal meaning they will continue processing
 *
 * You should also be able to provide custom hook functions to do more complex stuff.
 * A custom.js (or local.js?) file is checked and imported.
 * All methods are run as async / await to allow for complex calls
 *
 * onInit - On startup
 * beforeProcessing - Before any scan processing. It's given the configuration options and can manipulated them, like add complex regex to the exclude
 * beforeFileProcessing - Before a specific file is processed. It's given a file entry and the general config info and you can change the file entry or do custom actions
 * afterFileProcessing - After a file has been uploaded
 * afterProcessing - After all processing for a scan / round is complete
 * onEnd - On a clean shutdown
 *
 *
 * Note that there's a watcher or if not available a polling system that checks to see if there's any newly modified files for being uploaded and adds them to the queue.
 * The file processing will check to see if the file exists on S3 and has the same size and SHA512 hash.
 */
class QueueConsumer {
    status = 'init';
    processingQueue;

    constructor() {
        // Stuff

    };

    addToQueue() {

    }


    processQueueEntry = async (treeEntry) => {

        const basePath = treeEntry.basePath;
// Expects the AWS object is created

        // console.log("Uploading file to S3: ", {treeEntry, basePath});

        let uploadLocationKey = s3BucketFolder + treeEntry.path.replace(basePath, ''); // @todo: remove basePath from treeEntry

        // @todo: Ensure the file doesn't already exist
        let uploadParams = {Bucket: s3BucketName, Key: uploadLocationKey, Body: ''};
        let localFilePath = path.join(treeEntry.path); // Convert to a local filepath that fs can read
        console.debug("Uploading file to S3: ", {
            uploadParams,
            uploadLocationKey,
            basePath,
            s3BucketFolder,
            treeEntry,
            filePath: localFilePath
        });

        // return uploadLocationKey;

        status = {checkingIfFileExists: true, uploadLocationKey};
        // @todo: Check if the file exists before trying to upload it again
        // @todo: Check if the file exists before trying to upload it again
        // @todo: Check if the file exists before trying to upload it again
        // @todo: Check if the file exists before trying to upload it again
        //await s3.
        // Check OVERWRITE_EXISTING_IF_DIFFERENT

        status = {uploading: true, uploadLocationKey};
        let fileStream = fs.createReadStream(localFilePath); // A test pixel that's only 43bytes in size
        fileStream.on('error', function (err) {
            console.log('File Error', err);
            return err;
        });
        console.debug("Uploading the file: ", {filePath: localFilePath, awsRegion: process.env.AWS_REGION, uploadParams});
        uploadParams.Body = fileStream;
        await s3.upload(uploadParams, function (err, data) {
            if (err) {
                console.log("S3 Upload Error", err);
                return err;
            } else if (data) {
                console.log("S3 Upload Success", data.Location);
                return data;
                /* e.g data:  {
                  ETag: '"958c6ad2c1183fee0bf0dd489f4204c7"',
                  Location: 'https://bucket-location.s3.us-east-2.amazonaws.com/files/v1-0005.mp4',
                  key: 'files/v1-0005.mp4',
                  Key: 'files/v1-0005.mp4',
                  Bucket: 'bucket-location'
                }
                */
            }
        });
    }
}


module.exports = QueueConsumer;
