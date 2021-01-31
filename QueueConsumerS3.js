const QueueConsumerBase = require('./QueueConsumerBase.js');
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const AWS = require('aws-sdk');
const DeferredPromise = require('./DeferredPromise.js');
const _ = require('lodash');
const sha256File = require('sha256-file');

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
        S3_UPLOAD_OPTIONS_PART_SIZE: 10 * 1024 * 1024, // Default of 10MB or fine for files up to 100GB shouldn't be less than 5MB as per https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#upload-property but can't be more than 10,000 chunks so we adjust it for larger files
        S3_UPLOAD_OPTIONS_QUEUE_SIZE: 4, // The default number of threads to upload each part, as per https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3/ManagedUpload.html
        S3_UPLOAD_OPTIONS_TAGS: [], // e.g [{Key: 'tag1', Value: 'value1'}]
        S3_UPLOAD_ACL: 'bucket-owner-full-control' // The canned ACL to apply to the upload. Possible values include: "private" "public-read" "public-read-write" "authenticated-read" "aws-exec-read" "bucket-owner-read" "bucket-owner-full-control"
    }

    processQueueEntry = async (treeEntry) => {

        // return new Promise((resolve, reject) => {
        const basePath = treeEntry.basePath;

        let s3BucketFolder = this.config.AWS_S3_BUCKET_FOLDER;
        let s3BucketName = this.config.AWS_S3_BUCKET;
        let uploadLocationKey = s3BucketFolder + treeEntry.path.replace(basePath, ''); // @todo: remove basePath from treeEntry
        let localFilePath = path.join(treeEntry.path); // Convert to a local filepath that fs can read

        // Example fsStat:
        // {
        //     dev: 1733172691,
        //     mode: 33206,
        //     nlink: 1,
        //     uid: 0,
        //     gid: 0,
        //     rdev: 0,
        //     blksize: 4096,
        //     ino: 50665495808138510,
        //     size: 43,
        //     blocks: 0,
        //     atimeMs: 1612086167975.0261,
        //     mtimeMs: 1610160450289.9504,
        //     ctimeMs: 1610160450289.9504,
        //     birthtimeMs: 1610160449423.793,
        //     atime: 2021-01-31T09:42:47.975Z,
        //     mtime: 2021-01-09T02:47:30.290Z,
        //     ctime: 2021-01-09T02:47:30.290Z,
        //     birthtime: 2021-01-09T02:47:29.424Z
        // }
        let fsStat;
        try {
            fsStat = fs.statSync(localFilePath);
            console.log(fsStat);
        } catch (err) {
            this.addError(err, `invalid local file ${localFilePath} s3 uploader can't upload it`);
            throw err;
            // return err;
        }

        if (!fsStat || !fsStat.size) {
            this.addError(fsStat, `invalid local file ${localFilePath} s3 uploader can't upload it`);
            throw new Error(`invalid local file ${localFilePath} no fsStat or empty file s3 uploader can't upload it`);
        }

        let s3ListObjectPromise = new DeferredPromise();
        let sha256FilePromise = new DeferredPromise();

        let fileSize = fsStat.size; // In Bytes
        let localFileSha256;
        let s3ListObject;

        // This could take a few moments to sha a full file
        sha256File(localFilePath, (err, sha256) => {
            if (err) {
                this.addError(err, `Error getting the SHA256 for the file ${localFilePath}`, err);
            }
            localFileSha256 = sha256;
            sha256FilePromise.resolve(sha256);
        });

        let uploadParams = _.merge({
            Bucket: s3BucketName,
            Key: uploadLocationKey,
            Body: '', // To be set to the stream later on
            ACL: this.config.S3_UPLOAD_ACL,
            StorageClass: this.config.S3_UPLOAD_STORAGE_CLASS,
        }, _.get(treeEntry, 's3UploadParams', {}));

        let uploadOptions = _.merge({
            // We allow the treeEntry to contain a specific s3UploadParams if you really want to do something special like setting a WebsiteRedirectLocation or SSECustomerKeyMD5 which would be per file specific
            // Check https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#upload-property for more options and

            partSize: this.config.S3_UPLOAD_OPTIONS_PART_SIZE, // if the file is such that it'll be split into more than 10k parts with the S3_UPLOAD_OPTIONS_PART_SIZE then we select a new part size
            queueSize: this.config.S3_UPLOAD_OPTIONS_QUEUE_SIZE,
            tags: this.config.S3_UPLOAD_OPTIONS_TAGS,
        }, _.get(treeEntry, 's3UploadOptions', {}));


        sha256FilePromise.then(sha256 => {
            uploadOptions.tags.push({Key: 's3UploaderSHA256', Value: sha256});


        });
        // For info on how it does automatic chunking checkout https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3/ManagedUpload.html
        // You might want to set your own s3UploadOptions to get your own tags


        // resolve({uploadParams});


        this.addActivity(`Processing S3 entry ${uploadLocationKey}`, {
            localFilePath,
            uploadParams,
            treeEntry,
            fsStats: fsStat
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


        s3.listObjectsV2({Bucket: s3BucketName, Prefix: uploadLocationKey, MaxKeys: 1}, (err, listObjects) => {
                if (err) {
                    this.addError(err, `S3 listObjectsV2 for ${uploadLocationKey}`);
                    s3ListObjectPromise.reject(err);
                    throw new Error(err);
                } else {
                    // Example data: {"IsTruncated":false,"Contents":[
                    // {
                    // "Key":"testing/1x1.gif",
                    // "LastModified":"2021-01-31T06:44:53.000Z",
                    // "ETag":"\\"d41d8cd98f00b204e9999999fff8427e\\"",
                    // "Size":0,
                    // "StorageClass":"STANDARD"
                    // }
                    // ],"Name":"bucket-location","Prefix":"testing/1x1.gif","MaxKeys":1,"CommonPrefixes":[],"KeyCount":1}
                    // NB: If the file doesn't already exist then the Contents is an empty array and KeyCount is 0. e.g  {"IsTruncated":false,"Contents":[],"Name":"testing-s3uploader","Prefix":"testing/1x1.gif","MaxKeys":2,"CommonPrefixes":[],"KeyCount":0}
                    s3ListObject = listObjects;
                    // this.addActivity(`S3 listObjectsV2 data for ${uploadLocationKey} is: `, data);
                    this.addActivity(`S3 listObjectsV2 data for ${uploadLocationKey} is: `, s3ListObject);

                    let fileEntryS3 = _.get(s3ListObject, 'Contents.0');
                    if (_.get(s3ListObject, 'Contents.length' > 0) && fileEntryS3) {
                        // File already exists
                        if (false === this.shouldReplaceExistingFileUpload(fileEntryS3, fsStat)) {

                            throw new Error(`shouldReplaceExistingFile is false, so not replacing ${localFilePath}`);
                        }
                    }
                }
                s3ListObjectPromise.resolve(listObjects);
            }
        );


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
                return {
                    localFilePath,
                    data,
                    uploadProcessingTime,
                    treeEntry,
                };
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

    postProcessEntry = async (queueEntry, processQueueResponse) => {
        // @todo: Remove the file if DELETE_ON_UPLOAD=true
        return queueEntry;
    }

    /**
     * Should Replace Existing File
     *
     * @param fileEntryS3 {Object} e.g { "Key":"testing/1x1.gif", "Size":64, "LastModified":"2021-01-31T06:44:53.000Z", "ETag":"\\"d41d8cd98f00b204e9999999fff8427e\\"",  "StorageClass":"STANDARD" }
     * @param fsStat e.g {size: 43, mtimeMs: 1610160450289.9504, mtime: 2021-01-09T02:47:30.290Z, ...}
     * @returns {boolean}
     */
    shouldReplaceExistingFileUpload = async (fileEntryS3, fsStat) => {
        let overwriteFile = false;
        if (true === _.get(this.config, 'OVERWRITE_EXISTING_IF_DIFFERENT', false)) {
            // Check if the filesize of modified time are different
            if (fileEntryS3.Size !== fsStat.size) {
                this.addActivity(`You should replace the existing file upload because OVERWRITE_EXISTING_IF_DIFFERENT is true and the filesize on S3 is ${fileEntryS3.Size} but on the local filesystem it is ${fsStat.size}`);
                return true;
            }
            let lastModifiedS3Date = new Date(fileEntryS3.LastModified);
            let lastModifiedLocalDate = new Date(fsStat.mtimeMs);
            console.log('The lastModifiedS3Date is: ', lastModifiedS3Date);


            // @todo: Check if the SHA256 tag is added, if so, use that otherwise check the modified local date
            // @todo: Work out if the lastModifiedLocalDate is later than the lastModifiedS3Date
        }
        return overwriteFile;
    }

    /**
     *
     * Can't have more than 10k parts
     * For the default of 5MB that's a max of ~50GB
     *
     * We default to 10MB, but this works it out if more than than
     *
     * @param fsStat
     */
    workOutS3PartSize(fsStat) {

        if ((fsStat.size / this.config.S3_UPLOAD_OPTIONS_PART_SIZE) < 10000) {
            return this.config.S3_UPLOAD_OPTIONS_PART_SIZE; // Use the default part size of 10MB
        }


        let partSize = Math.ceil(fsStat.size / 9998); // Work out how many parts (file chunks) will be needed, with some accounting for rounding errors
        this.addActivity(`The file is large it's ${fsStat.size / 1073741824} GB so setting the partSize to ${partSize}`);
        return partSize;
    }
}


module.exports = QueueConsumerS3;
