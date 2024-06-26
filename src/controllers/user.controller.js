import {asyncHandler} from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import {User} from '../models/user.model.js';
import {deleteFromCloudinary, uploadOnCloudinary} from '../utils/cloudinary.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import jwt from 'jsonwebtoken';
import { Subscription } from '../models/subscriptions.model.js';
import mongoose, { Mongoose } from 'mongoose';

const generateAccessAndRefreshTokens = async (userId)=>{
    try {
        const user = await User.findById(userId)
        const accessToken = user.generateAccessToken()
        const refreshToken = user.generateRefreshToken()

        user.refreshToken = refreshToken
        await user.save({validBeforeSave : false})

        return {accessToken , refreshToken}

    } catch (error) {
        throw new ApiError(500 , "something went wrong while generating refresh and access token")
    }
}

const registerUser = asyncHandler( async (req , res) => {
    // get user details from frontend
    // validation 
    // check if user already exists : username , email
    // ckeck for images , check for avatar
    // upload them to cloudinary , avatar
    // create user object - create entry in db
    // remove password and referesh tokrn field from response
    // check user creation
    // return res

    const {fullName , email , username , password} = req.body

    console.log("req.body in user.controller.js ", req.body)

    // console.log("email" , email)
    // if (fullName === null) {
    //     throw new ApiError(400 , "fullname is required")
    // }

    if (
        [fullName, email,username,password].some((field)=> field?.trim() === "")
    ) {
       throw new ApiError(400 , "fullname is required") 
    }

    const existedUser =await User.findOne({
        $or:[ { username },{ email } ]
    })

    console.log("existedUser in user.controller.js" , existedUser)

    if (existedUser) {
        throw new ApiError(409 , "User with email or username already exists")
    }
    console.log(req.files)

    const avatarLocalPath = req.files?.avatar[0]?.path;
    // const coverImageLocalPath = req.files?.coverImage[0]?.path;

    let coverImageLocalPath;
    if (req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0) {
        coverImageLocalPath = req.files.coverImage[0].path
    }

    if (!avatarLocalPath) {
        throw new ApiError(400,"Avatar file is required")
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath)
    const coverImage = await uploadOnCloudinary(coverImageLocalPath)

    if (!avatar) {
        throw new ApiError(400 , "avatar file is required")
    }

    const user = await User.create({
        fullName,
        avatar:avatar.url,
        coverImage:coverImage?.url || "",
        email,
        password,
        username:username.toLowerCase()
    })

    const createdUser = await User.findById(user._id).select(
        "-password -refreshToken"
    )

    if (!createdUser) {
        throw new ApiError(500 , "something went wrong while registering the user")
    }

    return res.status(201).json(
        new ApiResponse(200 , createdUser, "User registeres successfully")
    )


})

const loginUser = asyncHandler( async(req,res) => {
    //req.body -> data
    //username or email
    //find the user
    //password check
    //access and refresh token to the users
    //send the cookie
    //send response

    const {username , email , password} = req.body
    if(!(username || email)){
        throw new ApiError(400,"username or email is required")
    }

    const user = await User.findOne({
        $or:[{username},{email}]
    })

    if(!user){
        throw new ApiError(404, "user does not exist")
    }

    const isPasswordValid = await user.isPasswordCorrect(password)

    if(!isPasswordValid){
        throw new ApiError(401, "Invalid user credentials")
    }

    const {accessToken , refreshToken} = await generateAccessAndRefreshTokens(user._id)

    const loggedInUser = await User.findById(user._id).select("-password -refreshToken")

    const options = {
        httpOnly : true,
        secure : true
    }

    return res
    .status(200)
    .cookie("accessToken", accessToken , options)
    .cookie("refreshToken" , refreshToken , options)
    .json(
        new ApiResponse(
            200,
            {
                user:loggedInUser,refreshToken,accessToken
            },
            "User logged in Successfully"
            
        )
    )

})

const logoutUser = asyncHandler( async (req,res)=>{
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $set: {
                refreshToken:undefined
            }
        },
        {
            new:true
        }
    )

    const options = {
        httpOnly : true,
        secure : true
    }

    return res
    .status(200)
    .clearCookie("accessToken",options)
    .clearCookie("refreshToken",options)
    .json(
        new ApiResponse(200, {},"user successfully logged out")
    )
})

const refreshAccesstoken = asyncHandler( async (req , res) => {
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken

    if(!incomingRefreshToken){
        throw new ApiError(401,"Unauthorized request")
    }

    try {
        const decodedToken = jwt.verify(
            incomingRefreshToken,
            process.env.REFRESH_TOKEN_SECRET
        )
    
        const user = await User.findById(decodedToken?._id)
    
        if(!user){
            throw new ApiError(401,"Invalid RefreshToken")
        }
    
        if(incomingRefreshToken !== user?.refreshToken) {
            throw new ApiError(401, "Refresh token is expired or used")
        }
    
        const options = {
            httpOnly: true,
            secure:true
        }
    
        const {accessToken, newRefreshToken} = await generateAccessAndRefreshTokens(user._id)
    
        return res
        .status(200)
        .cookie("accessToken", accessToken , options)
        .cookie("refreshToken" , newRefreshToken ,options)
        .json(
            new ApiResponse(
                200,
                {accessToken, refreshToken:newRefreshToken},
                "Access token refreshed"
            )
        )
    } catch (error) {
        throw new ApiError(401,error?.message || "invalid refresh token")
    }
    
    
})

const changeCurrentPassword = asyncHandler( async (req,res) => {

    const {oldPassword , newPassword} = req.body

    const user = await User.findById(req.user?._id)

    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword)

    if(!isPasswordCorrect){
        throw new ApiError(400,"invalid Password")
    }

    user.password = newPassword
    await user.save({
        validBeforeSave:false
    })

    return res.status(200).json(
        new ApiResponse(200 ,{},"Password Changed Successfully" )
    )
})

const getCurrentUser = asyncHandler( async(req,res) => {
    return res.status(200).json(ApiResponse(200, req.user,"Current user fetched Successfully"))
})

const updateAccountDetails = asyncHandler( async (req,res) => {
    const {fullName , email} = req.body

    if(!fullName || !email){
        throw new ApiError(400,"All fields are required")
    }

    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set:{
                fullName,
                email:email
            }
        },
        {new:true}
    ).select("-password")

    return res
    .status(200)
    .json(ApiResponse(200,user,"Account details updated successfully"))
})

const updateUserAvatar = asyncHandler( async (req , res) => {
    const userFileToBeDeleted = await User.findById(req.user?._id)

    const avatarLocalPath = req.file?.path

    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is missing")
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath)

    if(!avatar.url){
        throw new ApiError(400 ,"Error while uploading file on cloudinary")
    }

    const user = await User.findByIdAndUpdate(
        req.user?._id ,
        {
            $set:{
                avatar:avatar.url
            }
        },
        {new:true}
    ).select("-password")

    const deletedFile = await deleteFromCloudinary(userFileToBeDeleted.avatar)

    console.log(deletedFile) // consoling the deleted file

    return res
    .status(200)
    .json(new ApiError(200 , user ,"Avatar file updated Successfully"))
})

const updateUserCoverImage = asyncHandler( async (req,res) => {
    const coverImageLocalPath = req.file?.path

    if(!coverImageLocalPath){
        throw new ApiError(400, "Cover image is missing")
    }

    const coverImage = await uploadOnCloudinary(coverImageLocalPath)

    if(!coverImage.url){
        throw new ApiError(400, "Error while uploading the file on cloudinary")
    }

    const user = await User.findByIdAndUpdate(
        req.user._id,
        {
            $set:{
                coverImage:coverImage.url
            }
        },
        {new:true}
    ).select("-password")

    return res
    .status(200)
    .json(new ApiResponse(200, user , "Cover image updated Successfully"))

})


// aggregation pipeline 

const getUserChannelprofile = asyncHandler( async (req,res) => {
    const {username} = req.params

    if (!username?.trim()) {
        throw new ApiError(400 , "username is missing")
    }

    const channel = await User.aggregate([
        {
            $match:{
                username:username?.toLowerCase()
            }
        },
        {
            $lookup:{
                from:"subscriptions",
                localField:"_id",
                foreignField:"channel",
                as:"subscribers"
            }
        },
        {
            $lookup:{
                from:"subscriptions",
                localField:"_id",
                foreignField:"subscriber", // we counted the subscribers 
                as:"subscribedTo"         // to find to who user has subscribed
            }
        },
        {
            $addFields:{
                subscribersCount:{
                    $size:"$subscribers"
                },
                channelsSubscribedToCount:{
                    $size:"$subscribedTo"
                },
                isSubscribed:{
                    $cond:{
                        if:{$in: [req.user?._id, "$subscribers.subscriber"]},
                        then:true,
                        else:false
                    }
                }
            }
        },
        {
            $project:{
                fullName:1,
                username:1,
                subscribersCount:1,
                channelsSubscribedToCount: 1,
                isSubscribed:1,
                avatar:1,
                coverImage:1,
                email:1

            }
        }
    ])


    if(!channel?.length){
        throw new ApiError(404 , "Channel does not exist")
    }

    console.log(channel)

    return res
    .status(200)
    .json(new ApiResponse(200 , channel[0], "User Channel Fetched successfully"))
})

const getWatchHistory = asyncHandler( async (req,res) => {
    const user = await User.aggregate([
        {
            $match:{
                _id: new mongoose.Types.ObjectId(req.user._id)
            }
        },
        {
            $lookup:{
                from:"videos",
                localField:"watchHistory",
                foreignField:"_id",
                as:"watchHistory",
                pipeline: [
                    {
                        $lookup:{
                            from:"users",
                            localField:"owner",
                            foreignField:"_id",
                            as:"owner",
                            pipeline:[
                                {
                                    $project:{
                                        fullName:1,
                                        username:1,
                                        avatar:1
                                    }
                                }
                            ]
                        }
                    },
                    {
                        $addFields:{
                            owner:{
                                $first:"$owner"
                            }
                        }
                    }
                ]
            }
        }
    ])

    return res
    .status(200)
    .json(new ApiResponse(200,user[0].watchHistory, "Watch history fetched successfully"))
})





export {
    registerUser,
    loginUser,
    logoutUser,
    refreshAccesstoken,
    changeCurrentPassword,
    getCurrentUser,
    updateAccountDetails,
    updateUserAvatar,
    updateUserCoverImage,
    getUserChannelprofile,
    getWatchHistory
}
