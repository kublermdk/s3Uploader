const QueueConsumerBase = require('./QueueConsumerBase.js');
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const AWS = require('aws-sdk');
const DeferredPromise = require('./DeferredPromise.js');
const _ = require('lodash');

/**
 * S3 Upload file Queue Consumer
 *
 * For uploading files
 */
class QueueConsumerS3 extends QueueConsumerBase {

    // Expect the info to look something like:
    // config: {
    //     AWS_PROFILE: 'default',
    //     AWS_S3_BUCKET: 'myBucket',
    //     AWS_S3_BUCKET_FOLDER: 's3uploaderFiles',
    //     OVERWRITE_EXISTING_IF_DIFFERENT:
    // },

    /**
     * You need to specify the constructor in the extended Queue Consumer
     * and do your own merge if you want to have the defaultConfig get applied as intended
     * @param queueManager
     * @param consumerConfig
     * @param settings
     */
    constructor(queueManager, consumerConfig = {}, settings = {}) {
        super(queueManager, consumerConfig, settings);
        this.config = _.merge(this.config, this.defaultConfig, consumerConfig);
    }

    // The default configuration is added to the config in the constructor
    defaultConfig = {
        OVERWRITE_EXISTING_IF_DIFFERENT: true, // If the file is different (modified more recently or filesize different) then upload the new version
        OVERWRITE: false, // Overwrite no matter what
        S3_UPLOAD_STORAGE_CLASS: 'STANDARD', // The S3 upload StorageClass Possible values include: "STANDARD" "REDUCED_REDUNDANCY" "GLACIER" "STANDARD_IA" "ONEZONE_IA" "INTELLIGENT_TIERING" "DEEP_ARCHIVE" "OUTPOSTS" as per https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#upload-property
        S3_UPLOAD_OPTIONS_PART_SIZE: 10 * 1024 * 1024, // Shouldn't be less than 5MB as per https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#upload-property but can't be more than 10,000 chunks
        S3_UPLOAD_OPTIONS_QUEUE_SIZE: 4, // The default number of threads to upload each part, as per https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3/ManagedUpload.html
        S3_UPLOAD_ACL: 'bucket-owner-full-control' // The canned ACL to apply to the upload. Possible values include: "private" "public-read" "public-read-write" "authenticated-read" "aws-exec-read" "bucket-owner-read" "bucket-owner-full-control"
    }

    processQueueEntry = async (treeEntry) => {

        return new Promise(async (resolve, reject) => {
            const basePath = treeEntry.basePath;

            let s3BucketFolder = this.config.AWS_S3_BUCKET_FOLDER;
            let s3BucketName = this.config.AWS_S3_BUCKET;
            let uploadLocationKey = s3BucketFolder + treeEntry.path.replace(basePath, ''); // @todo: remove basePath from treeEntry
            let localFilePath = path.join(treeEntry.path); // Convert to a local filepath that fs can read
            let fsStats = fs.statSync(localFilePath);
            console.log(fsStats);

            // @todo: Get the ContentMD5
            // We allow the treeEntry to contain a specific s3UploadParams if you really want to do something special like setting a WebsiteRedirectLocation or SSECustomerKeyMD5 which would be per file specific
            // Check https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#upload-property for more options and
            // For info on how it does automatic chunking https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3/ManagedUpload.html
            let uploadParams = _.merge({
                Bucket: s3BucketName,
                Key: uploadLocationKey,
                Body: '', // To be set to the stream later on
                ACL: this.config.S3_UPLOAD_ACL,
                StorageClass: this.config.S3_UPLOAD_STORAGE_CLASS,
            }, _.get(treeEntry, 's3UploadParams', {}));

            let uploadOptions = {
                // if the file is such that it'll be split into more than 10k parts with the S3_UPLOAD_OPTIONS_PART_SIZE then we select a new part size
                partSize: this.config.S3_UPLOAD_OPTIONS_PART_SIZE,
                queueSize: this.config.S3_UPLOAD_OPTIONS_QUEUE_SIZE,
            }

            // resolve({uploadParams});


            this.addActivity(`Processing S3 entry ${uploadLocationKey}`, {
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
            if (this.config.s3) {
                s3 = this.config.s3;
            } else {
                this.addActivity("Creating the S3 entry");
                AWS.config.update({region: this.config.AWS_REGION}); // Likely to be 'us-east-2' Ohio
                s3 = new AWS.S3({apiVersion: '2006-03-01'});
            }


            // ===============================================================
            //    Check if the file already exists
            // ===============================================================
            // Check https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#listObjectsV2-property for the listObjectsV2 SDK
            let s3ListObjectPromise = new DeferredPromise();
            s3.listObjectsV2({Bucket: s3BucketName, Prefix: uploadLocationKey, MaxKeys: 2}, (err, data) => {
                    if (err) {
                        this.addError(err, `S3 listObjectsV2 for ${uploadLocationKey}`);
                        s3ListObjectPromise.reject(err);
                        reject(err);
                    } else {
                        // Example data: {"IsTruncated":false,"Contents":[{"Key":"testing/1x1.gif","LastModified":"2021-01-31T06:44:53.000Z","ETag":"\\"d41d8cd98f00b204e9999999fff8427e\\"","Size":0,"StorageClass":"STANDARD"}],"Name":"bucket-location","Prefix":"testing/1x1.gif","MaxKeys":1,"CommonPrefixes":[],"KeyCount":1}
                        // NB: If the file doesn't already exist then the Contents is an empty array and KeyCount is 0. e.g  {"IsTruncated":false,"Contents":[],"Name":"testing-s3uploader","Prefix":"testing/1x1.gif","MaxKeys":2,"CommonPrefixes":[],"KeyCount":0}

                        // this.addActivity(`S3 listObjectsV2 data for ${uploadLocationKey} is: `, data);
                        s3ListObjectPromise.resolve(data);
                    }
                }
            );

            let s3ListObject = await s3ListObjectPromise;
            this.addActivity(`S3 listObjectsV2 data for ${uploadLocationKey} is: `, s3ListObject);
            if (_.get(s3ListObject, 'Contents.length' > 0)) {
                // File already exists

                let overwriteFile = false;
                if (true === _.get(this.config, 'OVERWRITE_EXISTING_IF_DIFFERENT', false)) {
                    // if ()
                }

            }
            // this.addActivity("The s3ListObject is: " + JSON.stringify(s3ListObject));

            // // @todo: Check if the file exists before trying to upload it again
            // // @todo: Check if the file exists before trying to upload it again
            // // @todo: Check if the file exists before trying to upload it again
            // // @todo: Check if the file exists before trying to upload it again
            // //await s3.
            // // Check OVERWRITE_EXISTING_IF_DIFFERENT
            //

            let uploadingStartTime = new Date();
            this.addActivity(`Uploading file to S3 ${localFilePath}`);
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
            s3.upload(uploadParams, uploadOptions, (err, data) => {
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
