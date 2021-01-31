const QueueConsumerBase = require('./QueueConsumerBase.js');
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const AWS = require('aws-sdk');
const DeferredPromise = require('./DeferredPromise.js');

/**
 *
 */
class QueueConsumerS3 extends QueueConsumerBase {

    // Expect the info to look something like:
    // info: {
    //     AWS_PROFILE: 'default',
    //     AWS_S3_BUCKET: 'myBucket',
    //     AWS_S3_BUCKET_FOLDER: 's3uploaderFiles',
    // },

    processQueueEntry = async (treeEntry) => {

        return new Promise(async (resolve, reject) => {
            const basePath = treeEntry.basePath;
// Expects the AWS object is created

            // console.log("Uploading file to S3: ", {treeEntry, basePath});

            let s3BucketFolder = this.info.AWS_S3_BUCKET_FOLDER;
            let s3BucketName = this.info.AWS_S3_BUCKET;
            let uploadLocationKey = s3BucketFolder + treeEntry.path.replace(basePath, ''); // @todo: remove basePath from treeEntry


            //
            // // @todo: Ensure the file doesn't already exist
            let uploadParams = {Bucket: s3BucketName, Key: uploadLocationKey, Body: ''};

            // resolve({uploadParams});

            let localFilePath = path.join(treeEntry.path); // Convert to a local filepath that fs can read
            let fsStats = fs.statSync(localFilePath);
            this.addActivity("Processing S3 entry: ", {
                localFilePath,
                uploadParams,
                treeEntry,
                fsStats
            });
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

            // resolve({
            //     localFilePath,
            //     uploadParams,
            //     treeEntry
            // });

            // -- Create S3 service object
            let s3;
            if (this.info.s3) {
                s3 = this.info.s3;
            } else {
                this.addActivity("Creating the S3 entry");
                AWS.config.update({region: this.info.AWS_REGION}); // Likely to be 'us-east-2' Ohio
                s3 = new AWS.S3({apiVersion: '2006-03-01'});
            }


            let s3ListObjectPromise = new DeferredPromise();
            s3.listObjectsV2({Bucket: s3BucketName, Prefix: uploadLocationKey, MaxKeys: 1}, (err, data) => {
                    if (err) {
                        this.addError(err, `S3 listObjectsV2 for ${uploadLocationKey}`);
                        s3ListObjectPromise.reject(err);
                    } else {
                        // Example data: {"IsTruncated":false,"Contents":[{"Key":"testing/1x1.gif","LastModified":"2021-01-31T06:44:53.000Z","ETag":"\\"d41d8cd98f00b204e9999999fff8427e\\"","Size":0,"StorageClass":"STANDARD"}],"Name":"bucket-location","Prefix":"testing/1x1.gif","MaxKeys":1,"CommonPrefixes":[],"KeyCount":1}
                        this.addActivity(`S3 listObjectsV2 data for ${uploadLocationKey} is: ` + JSON.stringify(data));
                        s3ListObjectPromise.resolve(data);
                    }
                }
            );



            await s3ListObjectPromise._promise;
            // this.addActivity("The s3ListObject is: " + JSON.stringify(s3ListObject));

            // // @todo: Check if the file exists before trying to upload it again
            // // @todo: Check if the file exists before trying to upload it again
            // // @todo: Check if the file exists before trying to upload it again
            // // @todo: Check if the file exists before trying to upload it again
            // //await s3.
            // // Check OVERWRITE_EXISTING_IF_DIFFERENT
            //

            let uploadingStartTime = new Date();
            this.addActivity("Uploading file to S3: " + JSON.stringify({
                localFilePath,
            }));
            let fileStream = fs.createReadStream(localFilePath); // A test pixel that's only 43bytes in size
            fileStream.on('error', (err) => {
                this.addError(err);
                console.error('File Error', err);
                return err;
            });
            // console.debug("Uploading the file: ", {
            //     filePath: localFilePath,
            //     awsRegion: process.env.AWS_REGION,
            //     uploadParams
            // });
            // uploadParams.Body = fileStream;


            // ===============================================================
            //    Actually Upload the file
            // ===============================================================
            s3.upload(uploadParams, (err, data) => {
                if (err) {
                    this.addError(err, 'S3 Upload Error');
                    reject(err);
                } else if (data) {

                    let uploadProcessingTime = new Date().getTime() - uploadingStartTime.getTime(); // in ms
                    this.addActivity("Uploaded file to S3: " + JSON.stringify({
                        localFilePath,
                        data,
                        uploadProcessingTime: uploadProcessingTime + 'ms', // in ms
                    }));
                    // console.log("S3 Upload Success", data.Location);
                    resolve({
                        localFilePath,
                        data,
                        uploadProcessingTime,
                        treeEntry,
                    });
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
        });
    }

    postProcessEntry = async (queueEntry, processQueueResponse) => {
        // @todo: Remove the file if DELETE_ON_UPLOAD=true
        return queueEntry;
    }
}


module.exports = QueueConsumerS3;
