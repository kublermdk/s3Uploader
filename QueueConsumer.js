const QueueConsumerBase = require('./QueueConsumerBase.js');

/**
 *
 */
class QueueConsumer extends QueueConsumerBase {

    processQueueEntry = async (treeEntry) => {

        const basePath = treeEntry.basePath;
// Expects the AWS object is created

        // console.log("Uploading file to S3: ", {treeEntry, basePath});

        let uploadLocationKey = s3BucketFolder + treeEntry.path.replace(basePath, ''); // @todo: remove basePath from treeEntry


        //
        // // @todo: Ensure the file doesn't already exist
        let uploadParams = {Bucket: s3BucketName, Key: uploadLocationKey, Body: ''};
        // let localFilePath = path.join(treeEntry.path); // Convert to a local filepath that fs can read
        // console.debug("Uploading file to S3: ", {
        //     uploadParams,
        //     uploadLocationKey,
        //     basePath,
        //     s3BucketFolder,
        //     treeEntry,
        //     filePath: localFilePath
        // });
        //
        // // return uploadLocationKey;
        //
        // status = {checkingIfFileExists: true, uploadLocationKey};
        // // @todo: Check if the file exists before trying to upload it again
        // // @todo: Check if the file exists before trying to upload it again
        // // @todo: Check if the file exists before trying to upload it again
        // // @todo: Check if the file exists before trying to upload it again
        // //await s3.
        // // Check OVERWRITE_EXISTING_IF_DIFFERENT
        //
        // status = {uploading: true, uploadLocationKey};
        // let fileStream = fs.createReadStream(localFilePath); // A test pixel that's only 43bytes in size
        // fileStream.on('error', function (err) {
        //     console.log('File Error', err);
        //     return err;
        // });
        // console.debug("Uploading the file: ", {
        //     filePath: localFilePath,
        //     awsRegion: process.env.AWS_REGION,
        //     uploadParams
        // });
        // uploadParams.Body = fileStream;
        // await s3.upload(uploadParams, function (err, data) {
        //     if (err) {
        //         console.log("S3 Upload Error", err);
        //         return err;
        //     } else if (data) {
        //         console.log("S3 Upload Success", data.Location);
        //         return data;
        //         /* e.g data:  {
        //           ETag: '"958c6ad2c1183fee0bf0dd489f4204c7"',
        //           Location: 'https://bucket-location.s3.us-east-2.amazonaws.com/files/v1-0005.mp4',
        //           key: 'files/v1-0005.mp4',
        //           Key: 'files/v1-0005.mp4',
        //           Bucket: 'bucket-location'
        //         }
        //         */
        //     }
        // });
    }
}


module.exports = QueueConsumer;
