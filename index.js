const EventEmitter = require( "events" ),
      AppSwapStrategy = require( "./Lib/Strategy/AppSwap" ),
      ScriptSwapStrategy = require( "./Lib/Strategy/ScriptSwap" ),
      semver = require( "semver" ),
      os = require( "os" ),
      {lstatSync, existsSync} = require('fs'),
      { join, basename, dirname, parse } = require( "path" ),
      unpackTarGz = require( "./Lib/unpackTarGz" ),
      unpackZip = require( "./Lib/unpackZip" ),
      debounce = require( "debounce" ),

      { readJson, download }  = require( "./Lib/request" ),
      { launch, rtrim, remove } = require( "./Lib/utils" ),
      { PLATFORM_FULL, swapFactory,
        getExecutable, UPDATE_DIR, EXEC_DIR, BACKUP_DIR, LOG_PATH } = require( "./Lib/env" ),

      ERR_INVALID_REMOTE_MANIFEST = "Invalid manifest structure",
      DEBOUNCE_TIME = 100,

      DEFAULT_OPTIONS = {
        executable: null,
        backupDir: BACKUP_DIR,
        execDir: EXEC_DIR,
        updateDir: UPDATE_DIR,
        logPath: LOG_PATH,
        verbose: false,
        swapScript: null,
        strategy: "AppSwap",
        accumulativeBackup: false
      };


class AutoUpdater extends EventEmitter {
  /**
   * Create AutoUpdate
   * @param {Object} manifest
   * @param {Object} options
   */
  constructor( manifest, options = {}){

    super();

    this.manifest = manifest;

    this.release = "";
    this.argv = nw.App.argv;
    this.remoteManifest = "";
    this.options = Object.assign( {}, DEFAULT_OPTIONS, options );
    this.options.backupDir += this.options.accumulativeBackup ? `_${Math.floor(Date.now() / 1000)}` : ``;
    this.options.execDir = rtrim( this.options.execDir );
    this.options.executable = this.options.executable || getExecutable( manifest.name );
    // Mixing up a chosen strategy
    Object.assign( this, this.options.strategy === "ScriptSwap" ? ScriptSwapStrategy : AppSwapStrategy );
    if (this.options.debug){
      console.log("[nwautoupdater]   Paths",
                  { PLATFORM_FULL, swapFactory, getExecutable, UPDATE_DIR, EXEC_DIR, BACKUP_DIR, LOG_PATH });
      console.log("[nwautoupdater]   Options",
                  this.options);
    }

  }
  /**
   * Read package.json from the release server
   * @returns {Promise<JSON>}
   */
  async readRemoteManifest(opts){
    const url = this.options.url + 'package.json';
    try {
      return await readJson(url , opts );
    } catch ( e ) {
      throw new Error( `Cannot read remote manifest from ${url}` );
    }
  }
  /**
   * Check if a new app version available
   * @param {Object} remoteManifest
   * @returns {Promise<boolean>}
   */
  async checkNewVersion( remoteManifest ){
    if ( !remoteManifest || !remoteManifest["artifact-file"]){
      throw new TypeError( ERR_INVALID_REMOTE_MANIFEST );
    }
    return semver.gt( remoteManifest.version, this.manifest.version );
  }
  /**
   * Download new version
   * @param {Object} remoteManifest
   * @param {Object} options
   * @returns {Promise<string>}
   */
  async download(
    remoteManifest,
    opts = { debounceTime: DEBOUNCE_TIME },
  ){
    const { debounceTime } = opts;
    if ( !remoteManifest || !remoteManifest["artifact-file"] ){
      throw new TypeError( ERR_INVALID_REMOTE_MANIFEST );
    }
    const artifactUrl = this.options.url + remoteManifest["artifact-file"];
    const onProgress = ( length ) => {
      this.emit( "download", length);
    };
    try {
      remove( this.options.updateDir );
      return await download(
        artifactUrl,
        os.tmpdir(),
        debounce( onProgress, debounceTime ),
        opts
      );
    } catch ( e ) {
      throw new Error( `Cannot download package from ${artifactUrl}` );
    }
  }
  /**
   * Unpack downloaded version
   * @param {string} updateFile
   * @param {Object} options
   * @returns {Promise<string>}
   */
  async unpack( updateFile, { debounceTime } = { debounceTime: DEBOUNCE_TIME } ){
    const isZipRe = /\.zip$/i,
          isGzRe = /\.tar\.gz$/i,
          onProgress = ( installFiles, totalFiles ) => {
            this.emit( "install", installFiles, totalFiles );
          },
          updateDir = this.options.updateDir;

    if ( !updateFile ){
      throw new Error( "You have to call first download method" );
    }

    if(this.options.debug){
      console.log("[nwautoupdater]    Unpack", updateFile, updateDir)
    }

    switch( true ) {
      case isGzRe.test( updateFile ):
         try {
          await unpackTarGz( updateFile, updateDir, debounce( onProgress, debounceTime ) );
         } catch ( e ) {
            throw new Error( `Cannot unpack .tar.gz package ${updateFile}` );
         }
         break;
      case isZipRe.test( updateFile ):
         try {
          await unpackZip( updateFile, updateDir, debounce( onProgress, debounceTime ) );
         } catch ( e ) {
            throw new Error( `Cannot unpack .zip package ${updateFile}: ${e.message}` );
         }
         break;
      default:
         throw new Error( "Release archive of unsupported type" );
         break;
    }

      //If extract zip in new folder
      let newPath = join(updateDir, parse(updateFile).name);
      if (existsSync(newPath)) {
          if (lstatSync(newPath).isDirectory()) {
              this.options.updateDir = newPath;
          }
      }

    return updateDir;
  }

}

module.exports = {AutoUpdater: AutoUpdater};
