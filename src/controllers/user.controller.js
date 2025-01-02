import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken"
import mongoose from "mongoose";

// generate tokens using methods created in user.model like generateAccessToken, generateRefreshToken
const generateAccessAndRefreshTokens = async (userId) => {
    try {
        const user = await User.findById(userId)
        const accessToken = user.generateAccessToken()
        const refreshToken = user.generateRefreshToken()

        user.refreshToken = refreshToken  // change user refreshToken
        await user.save({ validateBeforeSave: false }) // save it to db

        return { accessToken, refreshToken }

    } catch (error) {
        throw new ApiError(500, "Something went wrong in generating tokens")
    }
}

const registerUser = asyncHandler(async (req, res) => {
    // get user details from frontend
    // validation
    // check if user already exists
    // check for images , check for avatar
    // upload them to cloudinary, avatar
    // create user object - create entry in db
    // remove password and refresh token field from response
    // check for user creation
    // return response 
    const { fullName, email, username, password } = req.body

    //check if field are empty using some() returns boolean
    //can add email format validation using regex
    if ([fullName, email, username, password].some((field) => field?.trim() === "")) {
        throw new ApiError(400, "All fields are required");
    }

    // check existing user using anyone of username, email using mongodb $or
    const existedUser = await User.findOne({
        $or: [{ username }, { email }]
    })

    if (existedUser) {
        throw new ApiError(409, "User with email already exists")
    }

    const avatarLocalPath = req.files?.avatar[0]?.path;
    // const coverImageLocalPath = req.files?.coverImage[0]?.path;

    let coverImageLocalPath;
    if (req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0) {
        coverImageLocalPath = req.files.coverImage[0].path;
    }

    if (!avatarLocalPath) {
        throw new ApiError(400, "avatar file is required");
    }

    // upload on cloudinary using local paths created by multer stored in upload folder
    const avatar = await uploadOnCloudinary(avatarLocalPath)
    const coverImage = await uploadOnCloudinary(coverImageLocalPath)

    if (!avatar) {
        throw new ApiError(400, "avatar file is required");
    }

    const user = await User.create({
        fullName,
        avatar: avatar.url,
        coverImage: coverImage?.url || "",
        email,
        password,
        username: username.toLowerCase()
    });

    const createdUser = await User.findById(user._id)
        .select("-password -refreshToken")

    if (!createdUser) {
        throw new ApiError(500, "Something went wrong while registering user")
    }

    return res.status(201).json(
        new ApiResponse(200, createdUser, "User registered Successfully")
    )

})

const loginUser = asyncHandler(async (req, res) => {
    // get details from frontend
    // validate username or email are given
    // find user
    // user password check
    // generate access and refresh token
    // send cookies 
    const { username, email, password } = req.body

    if (!username && !email) {
        throw new ApiError(400, "username or email is required")
    }

    // for any one check
    // if (!(username && email)) {
    //     throw new ApiError(400, "username or email is required")
    // }

    // login using anyone of username, email using mongodb $or //and find the user from db using username or email
    const user = await User.findOne({
        $or: [{ username }, { email }]
    })

    if (!user) {
        throw new ApiError(404, "User does nor exist")
    }
    // check password from db using isPasswordCorrect method created in user.model
    const isPasswordValid = await user.isPasswordCorrect(password)

    if (!isPasswordValid) {
        throw new ApiError(401, "invalid user credentials")
    }

    // generate tokens using methods created in user.model
    const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(user._id)

    const loggedInUser = await User.findById(user._id)
        .select("-password -refreshToken")

    // send tokens to frontend by using cookies
    const options = {
        httpOnly: true,
        secure: true
    }

    return res.status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(
            // optional to send tokens already sent in cookies // sent because if user want to store in localStorage
            new ApiResponse(200, { user: loggedInUser, accessToken, refreshToken }, "User logged in Successfully")
        )
})

const logoutUser = asyncHandler(async (req, res) => {
    // remove refreshToken from db 
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $unset: {
                refreshToken: 1
            }
        },
        {
            new: true
        }
    )
    // clear tokens from cookies from client
    const options = {
        httpOnly: true,
        secure: true
    }

    return res.status(200)
        .clearCookie("accessToken", options)
        .clearCookie("refreshToken", options)
        .json(new ApiResponse(200, {}, "User logged Out"))

})

const refreshAccessToken = asyncHandler(async (req, res) => {
    // refreshToken from the user cookies 
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken;

    if (!incomingRefreshToken) {
        throw new ApiError(401, "unauthorized request")
    }

    try {
        const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET);

        const user = await User.findById(decodedToken?._id)

        if (!user) {
            throw new ApiError(401, "Invalid refresh token")
        }

        // check incomingRefreshToken is same as refreshToken in db
        if (incomingRefreshToken !== user?.refreshToken) {
            throw new ApiError(401, "Refresh token is Expired or used")
        }

        const options = {
            httpOnly: true,
            secure: true
        }

        // generating new accessToken and refreshToken
        const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(user._id)

        // pass newly generated tokens as cookies 
        return res.status(200)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", refreshToken, options)
            .json(
                new ApiResponse(200, { accessToken, refreshToken }, "Access tokens refreshed")
            )
    } catch (error) {
        throw new ApiError(401, error?.message || "Invalid refresh token")
    }

})

const changeCurrentPassword = asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = req.body

    const user = await User.findById(req.user?._id)
    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword)

    if (!isPasswordCorrect) {
        throw new ApiError(400, "Invalid old password")
    }

    user.password = newPassword // change user password
    await user.save({ validateBeforeSave: false }) // save in db

    return res.status(200).json(
        new ApiResponse(200, {}, "Password successfully")
    )
})

const getCurrentUser = asyncHandler(async (req, res) => {
    // const user = await User.findOne(req.user._id)
    // .select("-password -refreshToken")

    // if(!user){
    //     throw new ApiError(401, "User not found or not logged in")
    // }
    // return res.status(200).json(
    //     new ApiResponse(200, user, "current user fetched successfully")
    // )

    return res.status(200).json(
        new ApiResponse(200, req.user, "current user fetched successfully")
    )
})

const updateAccountDetails = asyncHandler(async (req, res) => {
    const { fullName, email } = req.body;
    if (!fullName || !email) {
        throw new ApiError(400, "All fields are required")
    }
    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                fullName,
                email
            }
        },
        { new: true }
    ).select("-password")

    return res.status(200).json(
        new ApiResponse(200, user, "Account details updated successfully")
    )
})

const UpdateUserAvatar = asyncHandler(async(req, res) => {

    const avatarLocalPath = req.file?.path

    if(!avatarLocalPath){
        throw new ApiError(400, "Avatar file is missing")
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath)

    if(!avatar.url){
        throw new ApiError(400, "Error while uploading Avatar")
    }

    const user = await User.findByIdAndUpdate(req.user?._id,
        {
            $set:{
                avatar: avatar.url
            }
        },
        {
            new: true
        }
    ).select("-password")
    return res.status(200).json(
        new ApiResponse(200, user, "Avatar updated successfully")
    )
})

const UpdateUserCoverImage = asyncHandler(async(req, res) => {

    const coverImageLocalPath = req.file?.path

    if(!coverImageLocalPath){
        throw new ApiError(400, "coverImage file is missing")
    }

    const coverImage = await uploadOnCloudinary(coverImageLocalPath)

    if(!coverImage.url){
        throw new ApiError(400, "Error while uploading coverImage")
    }

    const user = await User.findByIdAndUpdate(req.user?._id,
        {
            $set:{
                coverImage: coverImage.url
            }
        },
        {
            new: true
        }
    ).select("-password")
    return res.status(200).json(
        new ApiResponse(200, user, "CoverImage updated successfully")
    )
})

const getUserChannelProfile = asyncHandler(async(req, res) => {
    const {username} = req.params

    if(!username?.trim()){
        throw new ApiError(400, "username is missing")
    }

    // const user = User.find({username})
    const channel = await User.aggregate([
        {
            $match:{
                username:username?.toLowerCase()
            }
        },
        {
            $lookup:{
                from: "subscriptions",
                localField: "_id",
                foreignField: "channel",
                as: "subscribers"
            }
        },
        {
            $lookup:{
                from: "subscriptions",
                localField: "_id",
                foreignField: "subscriber",
                as: "subscribedTo"
            }
        },
        {
            $addFields:{
                subscribersCount:{
                    $size: "$subscribers"
                },
                channelsSubscribedToCount:{
                    $size: "$subscribedTo"
                },
                isSubscribed:{
                    $cond:{
                        if: {$in: [req.user?._id, "$subscribers.subscriber"]},
                        then: true,
                        else: false
                    }
                }
            }
        },
        {
            $project:{
                fullName: 1,
                username: 1,
                subscribersCount: 1,
                channelsSubscribedToCount: 1,
                isSubscribed: 1,
                avatar: 1,
                coverImage: 1,
                email: 1
            }
        }
    ])

    if(!channel?.length){
        throw new ApiError(404, "channel does not exists")
    }

    return res.status(200).json(
        new ApiResponse(200, channel[0], "user channel fetched successfully")
    )
})

const getWatchHistory = asyncHandler(async(req, res) => {
    const user = await User.aggregate([
        {
            $match:{
                _id: new mongoose.Types.ObjectId(req.user?._id)
            }
        },
        {
            $lookup:{
                from: "videos",
                localField: "watchHistory",
                foreignField: "_id",
                as: "watchHistory",
                pipeline: [
                    {
                        $lookup:{
                            from: "users",
                            localField: "owner",
                            foreignField: "_id",
                            as: "owner",
                            pipeline: [
                                {
                                    $project:{
                                        fullName: 1,
                                        username: 1,
                                        avatar: 1
                                    }
                                }
                            ]
                        }
                    },
                    {
                        $addFields:{
                            owner:{
                                $first: "$owner"
                            }
                        }
                    }
                ]
            }
        }
    ])

    return res.status(200).json(new ApiResponse(200, user[0].watchHistory, "watch history fetched successfully"))
})

export {
    registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken,
    changeCurrentPassword,
    getCurrentUser,
    updateAccountDetails,
    UpdateUserAvatar,
    UpdateUserCoverImage,
    getUserChannelProfile,
    getWatchHistory
}