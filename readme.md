# S3 Uploader

This is a fairly basic node.js script / service which will monitor a folder and upload any associated files to S3.

Other scripts likely exist that already do this. I haven't looked.

Author: Michael Kubler ( @kublermdk )

### Intent
This script was created so that I could Rsync files into a folder on a server then have this script upload them to an S3 deep archive storage bucket for long term "just in case" storage.
I tried not to have too many extraneous files, but I don't know how to package a NodeJS app into a single file with all the node_modules and I realised that's not needed.
Still, s3uploader.js, package.json and .env are the files you need for this to work, along with the node_modules folder created when you run npm install. 


## Install
Assumptions:
* You've already got [NodeJS](https://nodejs.dev/) / NPM installed
* You've got an AWS account with an S3 bucket
* You've created an AWS IAM account which can access the S3 bucket and upload to it
* You've setup an [AWS credential file](https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/loading-node-credentials-shared.html).

1. git clone the repo (or download) to a computer (Windows or Linux)
2. Copy the sample.env to be named just .env
3. Configure the .env file as needed (check below for information about the settings)
4. Run `npm install`
5. Run `npm run uploader` or simply `node s3uploader.js`



## Settings
Most settings are configured via a .env variable


    AWS_REGION=us-east-1
    AWS_S3_BUCKET=
    AWS_S3_BUCKET_FOLDER=files/s3Uploaded
    LOCAL_FOLDER=/var/s3Upload
    DEBUG=true
    RECURSE_FOLDER=true
    FILE_EXTENSIONS=mp4|avi|mkv
    MIME_TYPES=video/mp4,video/x-ms-wmv,video/x-flv,video/quicktime ; NB: Not enabled yet (requires a file stat check for each file)
    IGNORE_SELF=true
    LOCAL_EXCLUDE=/node_modules/

`LOCAL_FOLDER` is the location of the folder to periodically check and process. It defaults to the folder s3uploader.js is saved at if not specified.
You can also specify a different folder by providing it as the first argument. e.g `node s3uploader.js /path/to/folder/`

`AWS_S3_BUCKET` is the bucket name of where you want the files to be uploaded to. This is required and we do a list buckets check at the start to ensure you can see the bucket.

`AWS_S3_BUCKET_FOLDER` allows you to specify an optional subfolder in the S3 bucket. e.g `images`
Don't include a trailing nor initial `/`

`DEBUG` if set to 'true' will output more information, like a listing of the AWS buckets, etc..

`RECURSE_FOLDER` if set to false we won't check any sub folders of the LOCAL_FOLDER
Note that because the sub folders are manually removed after dir tree is run the total size for the folder includes the sub folders.

`FILE_EXTENSIONS` is a way of specifying a filter for the files in the local folder.
Note that this is fed into a regex for [directory-tree](https://www.npmjs.com/package/directory-tree) e.g `extensions: /\.(md|js|html|java|py|rb)$/` so you can be fairly fancy if you know what you're doing 

`LOCAL_EXCLUDE` is a way of specifying a files or folders to exclude.
Note that this is fed into a regex for [directory-tree](https://www.npmjs.com/package/directory-tree) e.g `exclude: /some_path_to_exclude/` so you can be fairly fancy if you know what you're doing


If neither FILE_EXTENSIONS nor MIME_TYPES are specified then all file types are uploaded.

`IGNORE_SELF` if true will check if the files are any supplied by s3 Uploader. It means you can run s3 uploader in the folder with other files to be uploaded and not upload s3 uploader itself.




Resources:

https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/loading-node-credentials-shared.html "Loading Credentials in Node.js from the Shared Credentials File" You'll want to ensure you've got a ~/

https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/s3-example-creating-buckets.html - To help understand the uploader code




Possible Todo
--------------

These are things I'm interested in doing if people show interest:

* Create the S3 bucket if it doesn't already exist
* Allow mime type filtering e.g: MIME_TYPES=video/mp4,video/x-ms-wmv,video/x-flv,video/quicktime
* Maybe some better way of removing sub folders for when RECURSE_FOLDER is false; 