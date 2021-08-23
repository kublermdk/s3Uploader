# GT Async Queue


Based on the S3 Uploader

This is a fairly basic node.js script / service which will monitor a folder and upload any associated files to S3.

Other scripts likely exist that already do this. I haven't looked.

Author: Michael Kubler ( @kublermdk )

### Intent

This script was created so that I could Rsync files into a folder on a server then have this script upload them to an S3
deep archive storage bucket for long term "just in case" storage. I tried not to have too many extraneous files, but I
don't know how to package a NodeJS app into a single file with all the node_modules and I realised that's not needed.
Still, asyncQueue.js, package.json and .env are the files you need for this to work, along with the node_modules folder
created when you run npm install.

## Install

Assumptions:

* You've already got [NodeJS](https://nodejs.dev/) / NPM installed
* You've installed the Gather Together CLI (and likely the web app)
* You have a MongoDB database running, either locally or on the Cloud, e.g MongoDB Atlas 


1. git clone the repo (or download) to a computer (Windows or Linux)
2. Copy the sample.env and name it just `.env` e.g > `cp sample.env .env`
3. Configure the `.env` file as needed (check below for information about the settings)
4. Run `npm install`
5. Run `npm run uploader` or simply `node asyncQueue.js`

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
    DELETE_ON_PROCESSED=false

`LOCAL_FOLDER` is the location of the folder to periodically check and process. It defaults to the folder asyncQueue.js
is saved at if not specified. You can also specify a different folder by providing it as the first argument.
e.g `node asyncQueue.js /path/to/folder/`

`AWS_S3_BUCKET` is the bucket name of where you want the files to be uploaded to. This is required and we do a list
buckets check at the start to ensure you can see the bucket.

`AWS_S3_BUCKET_FOLDER` allows you to specify an optional subfolder in the S3 bucket. e.g `images`
Don't include a trailing nor initial `/`

`DEBUG` if set to 'true' will output more information, like a listing of the AWS buckets, etc..

`RECURSE_FOLDER` if set to false we won't check any sub folders of the LOCAL_FOLDER Note that because the sub folders
are manually removed after dir tree is run the total size for the folder includes the sub folders.

`FILE_EXTENSIONS` is a way of specifying a filter for the files in the local folder. Note that this is fed into a regex
for [directory-tree](https://www.npmjs.com/package/directory-tree) e.g `extensions: /\.(md|js|html|java|py|rb)$/` so you
can be fairly fancy if you know what you're doing

`LOCAL_EXCLUDE` is a way of specifying a files or folders to exclude. Note that this is fed into a regex
for [directory-tree](https://www.npmjs.com/package/directory-tree) e.g `exclude: /some_path_to_exclude/` so you can be
fairly fancy if you know what you're doing

If neither FILE_EXTENSIONS nor MIME_TYPES are specified then all file types are uploaded.

`IGNORE_SELF` if true will check if the files are any supplied by s3 Uploader. It means you can run s3 uploader in the
folder with other files to be uploaded and not upload s3 uploader itself.

`DELETE_ON_PROCESSED` if true will delete the local file after it's been uploaded (done in the post processing method of
the queueConsumer)

`OVERWRITE_EXISTING_IF_DIFFERENT=true` Will overwrite files if true (defaults to true) and:

1. There's already a file there to overwrite (if there's nothing there it'll definitely upload the file)
2. The file size is different
3. There's SHA tags of the existing file (the s3UploaderSHA256 tag added automatically to files it uploads) and the
   SHA256 is different to that of the local file
4. If there's no SHA tag then if the local file is modified more recently than what's on S3 it'll overwrite

`OVERWRITE=false` if True the uploader will replace any existing files even if they are the same.

`OUTPUT_ACTIVITY_LOGS=false` If true then it'll console.log the output as things are running. Useful for logging but
defaults to false so you don't get overwhelmed

`OUTPUT_ERRORS=true` output error defaults to true and will console.error() when something goes wrong. Can be set to
false if you don't want any output

`SINGLE_UPLOAD_RUN=false` if true then only process the files there then close. If false (default) then it'll continue
running and checking for file changes

`FILE_CHANGE_POLLING_TIME=20` How many seconds to wait between file system checks to find new or changed files (tune to
your needs, or submit a pull request with a working file watcher system but that doesn't seem reliable)

`FILES_THAT_HAVE_CHANGED_OR_JUST_NEW=CHANGED` If 'NEW' only process the files that have been newly uploaded and ignore
those which have had their size or modified time changed (which is the default of CHANGED)

`STATUS_UPDATES_INTERVAL_SECONDS=false` If set to a number more than 0 then it will output status updates. These are
useful if you want to actively watch updates via the CLI or by tailing the logs. Otherwise it's suggested you use the
web interface

@todo: Get the Web Interface working

Resources:

https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/loading-node-credentials-shared.html "Loading
Credentials in Node.js from the Shared Credentials File" You'll want to ensure you've got a ~/

https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/s3-example-creating-buckets.html - To help understand
the uploader code

# Compile to a single file

As per https://dev.to/jochemstoel/bundle-your-node-app-to-a-single-executable-for-windows-linux-and-osx-2c89

The following should install pkg and run it, giving you 3 executable files, one for each of Windows, Mac and Linux This
hasn't been tested well.

    npm i pkg -g
    pkg .

# Testing

    npm install jest --global
    npm run test

Possible Todo
--------------

These are things I'm interested in doing if people show interest:

* Create the S3 bucket if it doesn't already exist
* Allow mime type filtering e.g: MIME_TYPES=video/mp4,video/x-ms-wmv,video/x-flv,video/quicktime
* Maybe some better way of removing sub folders for when RECURSE_FOLDER is false; 